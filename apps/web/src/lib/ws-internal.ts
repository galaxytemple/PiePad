// Server-to-server calls into apps/ws's /internal endpoints.
// Auth: shared AUTH_SECRET sent via x-internal-secret header.

const WS_INTERNAL_URL =
  process.env.WS_INTERNAL_URL ?? "http://127.0.0.1:1234";

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length === 0) throw new Error("AUTH_SECRET is required");
  return s;
}

const EVICT_TIMEOUT_MS = 5_000;

export async function evictRoomFromWs(
  roomId: string,
  reason: string
): Promise<void> {
  try {
    await fetch(`${WS_INTERNAL_URL}/internal/evict`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": getSecret(),
      },
      body: JSON.stringify({ roomId, reason }),
      signal: AbortSignal.timeout(EVICT_TIMEOUT_MS),
    });
  } catch (err) {
    // Best-effort: ws may be down, snapshot worker (or next reconnect)
    // will eventually drop the doc. We don't want to block the user's
    // delete on this.
    console.error("[ws-internal] evict failed", err);
  }
}
