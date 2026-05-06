import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const PISTON_URL = process.env.PISTON_URL ?? "http://localhost:2000";
const RATE_LIMIT_PER_MINUTE = Number(
  process.env.RUN_RATE_LIMIT_PER_MINUTE ?? 10
);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 10_000);
const COMPILE_TIMEOUT_MS = Number(
  process.env.COMPILE_TIMEOUT_MS ?? RUN_TIMEOUT_MS
);
// Margin so Piston's own kill-on-timeout fires before our fetch aborts.
const FETCH_ABORT_MARGIN_MS = 5_000;

const RunSchema = z.object({
  language: z.string().min(1).max(50),
  version: z.string().min(1).max(50).default("*"),
  code: z.string().max(64 * 1024),
  stdin: z.string().max(8 * 1024).optional(),
});

interface PistonStream {
  stdout: string;
  stderr: string;
  output: string;
  code: number | null;
  signal: string | null;
}

interface PistonResponse {
  language: string;
  version: string;
  run: PistonStream;
  compile?: PistonStream;
}

// Per-IP token bucket. In-memory only; will reset on dyno restart and isn't
// shared across instances. Phase 7 swaps for Redis.
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (bucket.count >= RATE_LIMIT_PER_MINUTE) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip = getClientIp(req);
  const limit = rateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = RunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { language, version, code, stdin } = parsed.data;

  const controller = new AbortController();
  const totalBudgetMs =
    RUN_TIMEOUT_MS + COMPILE_TIMEOUT_MS + FETCH_ABORT_MARGIN_MS;
  const timer = setTimeout(() => controller.abort(), totalBudgetMs);

  try {
    const pistonRes = await fetch(`${PISTON_URL}/api/v2/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        language,
        version,
        files: [{ content: code }],
        stdin: stdin ?? "",
        run_timeout: RUN_TIMEOUT_MS,
        compile_timeout: COMPILE_TIMEOUT_MS,
      }),
    });

    if (!pistonRes.ok) {
      const text = await pistonRes.text();
      return NextResponse.json(
        { error: "piston_error", status: pistonRes.status, body: text },
        { status: 502 }
      );
    }

    const result = (await pistonRes.json()) as PistonResponse;
    return NextResponse.json({
      language: result.language,
      version: result.version,
      stdout: result.run.stdout,
      stderr: result.run.stderr,
      code: result.run.code,
      signal: result.run.signal,
      compileStderr: result.compile?.stderr ?? null,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "timeout" }, { status: 504 });
    }
    return NextResponse.json(
      {
        error: "piston_unreachable",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
