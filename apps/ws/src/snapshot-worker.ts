import { createRequire } from "node:module";
import {
  saveSnapshot,
  SnapshotTooLargeError,
  touchRoomAccess,
} from "@piepad/db";
import { docs } from "y-websocket/bin/utils";
import type * as YType from "yjs";
import {
  clearDirty,
  getDirtyRooms,
  isEvicting,
} from "./persistence.js";

// Use the same CJS yjs instance as y-websocket/bin/utils — see persistence.ts.
const requireCjs = createRequire(import.meta.url);
const Y: typeof YType = requireCjs("yjs");

const INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 30_000);
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000; // 10 minutes
const JITTER_RATIO = 0.3;

let timer: NodeJS.Timeout | null = null;

// Y.encodeStateAsUpdate of an empty Y.Doc returns a 2-byte sentinel.
const EMPTY_STATE_BYTES = 2;

// Per-room exponential-backoff bookkeeping. Cleared on successful save or when
// the doc has been evicted/snapshot-skipped.
const consecutiveFailures = new Map<string, number>();
const nextRetryAt = new Map<string, number>();

function clearBackoff(roomId: string): void {
  consecutiveFailures.delete(roomId);
  nextRetryAt.delete(roomId);
}

function scheduleBackoff(roomId: string, now: number): number {
  const fails = (consecutiveFailures.get(roomId) ?? 0) + 1;
  consecutiveFailures.set(roomId, fails);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** (fails - 1), BACKOFF_MAX_MS);
  const jitter = Math.floor(Math.random() * JITTER_RATIO * base);
  const delay = base + jitter;
  nextRetryAt.set(roomId, now + delay);
  return delay;
}

export async function flushDirty(): Promise<void> {
  const dirty = Array.from(getDirtyRooms());
  const now = Date.now();
  for (const roomId of dirty) {
    if (isEvicting(roomId)) {
      clearDirty(roomId);
      clearBackoff(roomId);
      continue;
    }
    const retryAt = nextRetryAt.get(roomId);
    if (retryAt !== undefined && retryAt > now) continue;

    const doc = docs.get(roomId);
    if (!doc) {
      // Doc was evicted; persistence.writeState already snapshotted it.
      clearDirty(roomId);
      clearBackoff(roomId);
      continue;
    }
    try {
      const state = Y.encodeStateAsUpdate(doc);
      // Refuse to overwrite a good snapshot with an empty one.
      if (state.byteLength <= EMPTY_STATE_BYTES) {
        clearDirty(roomId);
        clearBackoff(roomId);
        continue;
      }
      await saveSnapshot(roomId, state);
      // Rooms with continuous edits never reconnect, so without this an active
      // pad's last_accessed_at would freeze at first-connect time and the
      // 30-day cleanup would silently delete it.
      await touchRoomAccess(roomId).catch((err) => {
        console.error(
          `[snapshot-worker] touchRoomAccess failed for ${roomId}:`,
          err
        );
      });
      clearDirty(roomId);
      clearBackoff(roomId);
    } catch (err) {
      if (err instanceof SnapshotTooLargeError) {
        // Permanent for this state — retrying with the same blob will fail
        // identically. Drop dirty so the next update gets a fresh chance.
        // LevelDB still holds the live state; Oracle snapshot is stale.
        console.error(
          `[snapshot-worker] snapshot too large for ${roomId} (${err.bytes}>${err.max} bytes); skipping`
        );
        clearDirty(roomId);
        clearBackoff(roomId);
        continue;
      }
      const delay = scheduleBackoff(roomId, now);
      console.error(
        `[snapshot-worker] failed for ${roomId} (attempt ${consecutiveFailures.get(roomId)}, retry in ${Math.round(delay / 1000)}s):`,
        err
      );
      // Keep dirty so a future tick retries.
    }
  }
}

export function startSnapshotWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    flushDirty().catch((err) => {
      console.error("[snapshot-worker] tick error:", err);
    });
  }, INTERVAL_MS);
}

export function stopSnapshotWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Best-effort drain on shutdown. Bypasses backoff so a previously-failing room
// gets one final attempt before the process exits.
export async function drainOnShutdown(timeoutMs: number): Promise<void> {
  nextRetryAt.clear();
  await Promise.race([
    flushDirty(),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
