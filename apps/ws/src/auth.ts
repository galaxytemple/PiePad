import { decode } from "@auth/core/jwt";
import crypto from "node:crypto";
import type http from "node:http";
import { getRoomById } from "@piepad/db";

const AUTH_SECRET = process.env.AUTH_SECRET ?? "";
const SECURE_COOKIE = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = SECURE_COOKIE
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";
const ROOM_ID_RE = /^\/([A-Za-z0-9_-]{1,64})\/?$/;

export type AuthorizeResult =
  | { ok: true; userId: number; roomId: string }
  | { ok: false; reason: AuthorizeFailureReason };

export type AuthorizeFailureReason =
  | "bad_room_id"
  | "no_session"
  | "room_locked"
  | "auth_misconfigured";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(/;\s*/)) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1));
    } catch {
      out[key] = part.slice(eq + 1);
    }
  }
  return out;
}

// Auth.js v5 splits oversized session tokens into `<name>.0`, `<name>.1`, ...
function readSessionToken(cookies: Record<string, string>): string | null {
  const direct = cookies[SESSION_COOKIE_NAME];
  if (direct) return direct;
  const chunks: string[] = [];
  for (let i = 0; ; i++) {
    const chunk = cookies[`${SESSION_COOKIE_NAME}.${i}`];
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join("") : null;
}

interface SessionPayload {
  userId: number;
}

async function decodeSession(
  cookies: Record<string, string>
): Promise<SessionPayload | null> {
  const token = readSessionToken(cookies);
  if (!token) return null;
  try {
    const payload = (await decode({
      token,
      secret: AUTH_SECRET,
      salt: SESSION_COOKIE_NAME,
    })) as { userId?: unknown } | null;
    if (!payload || typeof payload.userId !== "number") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function hashUserAgent(ua: string): string {
  return crypto
    .createHash("sha256")
    .update(ua)
    .digest("hex")
    .slice(0, 16);
}

// Mirror of apps/web/src/lib/room-unlock.ts: cookie value is
// `<exp>.<hmac_sha256(roomId.userId.exp.uaHash)>` keyed on AUTH_SECRET.
function isUnlockCookieValid(
  cookieValue: string | undefined,
  roomId: string,
  userId: number,
  uaHash: string
): boolean {
  if (!cookieValue) return false;
  const dot = cookieValue.indexOf(".");
  if (dot < 0) return false;
  const exp = Number(cookieValue.slice(0, dot));
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const payload = `${roomId}.${userId}.${exp}.${uaHash}`;
  const expectedHmac = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(payload)
    .digest("hex");
  return timingSafeStringEqual(cookieValue, `${exp}.${expectedHmac}`);
}

function extractRoomId(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  const path = rawUrl.split("?")[0] ?? "";
  const match = ROOM_ID_RE.exec(path);
  return match?.[1] ?? null;
}

export async function authorizeUpgrade(
  req: http.IncomingMessage
): Promise<AuthorizeResult> {
  if (AUTH_SECRET.length === 0) {
    return { ok: false, reason: "auth_misconfigured" };
  }

  const roomId = extractRoomId(req.url);
  if (!roomId) return { ok: false, reason: "bad_room_id" };

  const cookies = parseCookies(req.headers.cookie);
  const session = await decodeSession(cookies);
  if (!session) return { ok: false, reason: "no_session" };

  // New rooms (created lazily by bindState) have no row yet; allow any signed-in
  // user to bootstrap them, matching today's create flow.
  const room = await getRoomById(roomId).catch(() => null);
  const isOwner =
    room !== null && room.createdByUserId === session.userId;
  const needsUnlock = room?.hasPassword === true && !isOwner;

  if (needsUnlock) {
    const unlockCookie = cookies[`pad_unlock_${roomId}`];
    const ua = req.headers["user-agent"];
    const uaString = typeof ua === "string" ? ua : (ua?.[0] ?? "");
    const uaHash = hashUserAgent(uaString);
    if (!isUnlockCookieValid(unlockCookie, roomId, session.userId, uaHash)) {
      return { ok: false, reason: "room_locked" };
    }
  }

  return { ok: true, userId: session.userId, roomId };
}
