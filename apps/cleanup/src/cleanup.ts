import { deleteRoomWithAudit, listExpiredRooms } from "@piepad/db";

const WS_INTERNAL_URL =
  process.env.WS_INTERNAL_URL ?? "http://127.0.0.1:1234";
const ROOM_TTL_DAYS = Number(process.env.ROOM_TTL_DAYS ?? 30);

function getInternalSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length === 0) throw new Error("AUTH_SECRET is required");
  return s;
}

// Without a timeout a hung ws process would block the cleanup tick on a
// single fetch until the OS TCP timeout (~2 min). Fail fast and let the next
// run retry; the LevelDB orphan is benign.
const EVICT_TIMEOUT_MS = 5_000;

async function evictFromWs(roomId: string): Promise<void> {
  try {
    const res = await fetch(`${WS_INTERNAL_URL}/internal/evict`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": getInternalSecret(),
      },
      body: JSON.stringify({ roomId, reason: "30_DAY_INACTIVITY" }),
      signal: AbortSignal.timeout(EVICT_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(
        `[cleanup] evict ${roomId} returned ${res.status}: ${await res.text()}`
      );
    }
  } catch (err) {
    // Best-effort. Worst case the LevelDB row stays orphaned until the
    // next cleanup run that does manage to talk to ws.
    console.error(`[cleanup] evict ${roomId} failed:`, err);
  }
}

export interface CleanupSummary {
  scanned: number;
  deleted: number;
  failed: number;
}

export async function runCleanupOnce(
  adminEmails?: string[]
): Promise<CleanupSummary> {
  const expired =
    adminEmails !== undefined
      ? await listExpiredRooms(ROOM_TTL_DAYS, 500, adminEmails)
      : await listExpiredRooms(ROOM_TTL_DAYS);
  let deleted = 0;
  let failed = 0;

  for (const room of expired) {
    try {
      // Evict first so any (unlikely) connected viewer sees the deleted
      // banner before we yank the row out. Also drops the LevelDB entry
      // even if no doc is in memory.
      await evictFromWs(room.id);
      // Audit + delete commit together — partial state (deleted with no audit
      // row, or audit row with no delete) is impossible.
      await deleteRoomWithAudit(room.id, room.name, "30_DAY_INACTIVITY");
      deleted += 1;
      console.log(
        `[cleanup] deleted room ${room.id} "${room.name}" (idle since ${room.lastAccessedAt.toISOString()})`
      );
    } catch (err) {
      failed += 1;
      console.error(`[cleanup] failed to delete ${room.id}:`, err);
    }
  }

  console.log(
    `[cleanup] scanned=${expired.length} deleted=${deleted} failed=${failed} ttlDays=${ROOM_TTL_DAYS}`
  );
  return { scanned: expired.length, deleted, failed };
}
