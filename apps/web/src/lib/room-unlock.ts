import crypto from "node:crypto";
import { cookies } from "next/headers";

const COOKIE_PREFIX = "pad_unlock_";
const TTL_SECONDS = 60 * 60 * 24; // 24h
// AUTH_SECRET is loaded by next.config.ts; it is the same secret Auth.js uses
// to sign session JWTs so anyone able to forge unlock cookies could already
// forge sessions. Using a different secret here would just add a 2nd footgun.
function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length === 0) throw new Error("AUTH_SECRET is required");
  return s;
}

function makeToken(roomId: string, userId: number, expiresAt: number): string {
  const payload = `${roomId}.${userId}.${expiresAt}`;
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
  return `${expiresAt}.${hmac}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

export async function setRoomUnlockCookie(
  roomId: string,
  userId: number
): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const token = makeToken(roomId, userId, expiresAt);
  const store = await cookies();
  store.set(`${COOKIE_PREFIX}${roomId}`, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TTL_SECONDS,
    path: `/pad/${roomId}`,
  });
}

export async function isRoomUnlocked(
  roomId: string,
  userId: number
): Promise<boolean> {
  const store = await cookies();
  const cookie = store.get(`${COOKIE_PREFIX}${roomId}`)?.value;
  if (!cookie) return false;
  const dot = cookie.indexOf(".");
  if (dot < 0) return false;
  const exp = Number(cookie.slice(0, dot));
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = makeToken(roomId, userId, exp);
  return constantTimeEqual(cookie, expected);
}

export async function clearRoomUnlockCookie(roomId: string): Promise<void> {
  const store = await cookies();
  store.delete(`${COOKIE_PREFIX}${roomId}`);
}
