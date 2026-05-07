import { auth } from "@/auth";
import { createRateLimiter } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

// PISTON_URL is the API root — code appends /execute. This lets us swap
// between self-hosted and the public API without forking call sites:
//   - self-hosted:  http://piston:2000/api/v2     (or 127.0.0.1 in dev)
//   - public:       https://emkc.org/api/v2/piston
// Default targets a local container, IPv4 to dodge Node's IPv6-first
// localhost resolution against Docker's IPv4-only port mapping.
const PISTON_URL = process.env.PISTON_URL ?? "http://127.0.0.1:2000/api/v2";
// emkc.org public API caps run_timeout/compile_timeout at 3000ms and 400s
// the request when we exceed it. Clamp anything pointed at the public host.
const IS_PUBLIC_PISTON = /emkc\.org/i.test(PISTON_URL);
const PUBLIC_PISTON_MAX_TIMEOUT_MS = 3_000;
const RATE_LIMIT_PER_MINUTE = Number(
  process.env.RUN_RATE_LIMIT_PER_MINUTE ?? 10
);
const RUN_TIMEOUT_MS = clampTimeout(
  Number(process.env.RUN_TIMEOUT_MS ?? 10_000)
);
const COMPILE_TIMEOUT_MS = clampTimeout(
  Number(process.env.COMPILE_TIMEOUT_MS ?? RUN_TIMEOUT_MS)
);
// Margin so Piston's own kill-on-timeout fires before our fetch aborts.
const FETCH_ABORT_MARGIN_MS = 5_000;

function clampTimeout(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return PUBLIC_PISTON_MAX_TIMEOUT_MS;
  if (IS_PUBLIC_PISTON) return Math.min(ms, PUBLIC_PISTON_MAX_TIMEOUT_MS);
  return ms;
}

const RunSchema = z.object({
  language: z.string().min(1).max(50),
  version: z.string().min(1).max(50).default("*"),
  code: z.string().max(64 * 1024),
  args: z.array(z.string().max(2048)).max(50).optional(),
});

interface PistonStream {
  stdout?: string;
  stderr?: string;
  output?: string;
  code?: number | null;
  signal?: string | null;
}

interface PistonResponse {
  language?: string;
  version?: string;
  run?: PistonStream;
  compile?: PistonStream;
  // Public emkc.org returns { message: "..." } on validation errors even
  // when status is 200, so accept it as part of the parsed shape.
  message?: string;
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pickIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pickStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Per-user token bucket. In-memory only — resets on process restart and
// isn't shared across replicas. Move to Redis if we ever scale out.
const runLimiter = createRateLimiter({
  limit: RATE_LIMIT_PER_MINUTE,
  windowMs: 60_000,
});

export async function POST(req: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const limit = runLimiter.consume(`user:${userId}`);
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

  const { language, version, code, args } = parsed.data;

  const controller = new AbortController();
  const totalBudgetMs =
    RUN_TIMEOUT_MS + COMPILE_TIMEOUT_MS + FETCH_ABORT_MARGIN_MS;
  const timer = setTimeout(() => controller.abort(), totalBudgetMs);

  try {
    const pistonRes = await fetch(`${PISTON_URL}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        language,
        version,
        files: [{ content: code }],
        args: args ?? [],
        run_timeout: RUN_TIMEOUT_MS,
        compile_timeout: COMPILE_TIMEOUT_MS,
      }),
    });

    // Read body once as text so we can log raw output when JSON parsing
    // or shape assumptions fail — the public emkc.org API has surprised
    // us with both error shapes and timeout-cap rejections.
    const rawBody = await pistonRes.text();

    // Never echo Piston's raw body to the client — it can leak internal URLs,
    // stack traces, or version strings. Log server-side and return a generic
    // shape with just the upstream status code.
    if (!pistonRes.ok) {
      console.error("[/api/run] Piston returned non-2xx", {
        url: PISTON_URL,
        status: pistonRes.status,
        body: rawBody,
        sent: { language, version },
      });
      return NextResponse.json(
        { error: "piston_error", status: pistonRes.status },
        { status: 502 }
      );
    }

    let result: PistonResponse;
    try {
      result = JSON.parse(rawBody) as PistonResponse;
    } catch {
      console.error("[/api/run] Piston returned non-JSON body", {
        url: PISTON_URL,
        body: rawBody.slice(0, 500),
      });
      return NextResponse.json(
        { error: "piston_invalid_response" },
        { status: 502 }
      );
    }

    // Public API uses { message } for validation errors at HTTP 200. The
    // message itself comes from the public API and is generally safe to show.
    if (!result.run && result.message) {
      console.error("[/api/run] Piston rejected request", {
        url: PISTON_URL,
        message: result.message,
        sent: { language, version },
      });
      return NextResponse.json(
        { error: "piston_rejected", message: result.message },
        { status: 502 }
      );
    }

    if (!result.run) {
      console.error("[/api/run] Piston response missing run section", {
        url: PISTON_URL,
        body: rawBody.slice(0, 500),
      });
      return NextResponse.json(
        { error: "piston_invalid_response" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      language: pickString(result.language) || language,
      version: pickString(result.version) || version,
      stdout: pickString(result.run.stdout),
      stderr: pickString(result.run.stderr),
      code: pickIntOrNull(result.run.code),
      signal: pickStringOrNull(result.run.signal),
      compileStderr: pickStringOrNull(result.compile?.stderr),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "timeout" }, { status: 504 });
    }
    console.error("[/api/run] Piston fetch failed", {
      url: PISTON_URL,
      error: err,
    });
    return NextResponse.json(
      { error: "piston_unreachable" },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
