import { createRequire } from "node:module";
import { saveSnapshot } from "@piepad/db";
import { docs } from "y-websocket/bin/utils";
import type * as YType from "yjs";
import { clearDirty, getDirtyRooms } from "./persistence.js";

// Use the same CJS yjs instance as y-websocket/bin/utils — see persistence.ts.
const requireCjs = createRequire(import.meta.url);
const Y: typeof YType = requireCjs("yjs");

const INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 30_000);

let timer: NodeJS.Timeout | null = null;

async function flushDirty(): Promise<void> {
  const dirty = Array.from(getDirtyRooms());
  for (const roomId of dirty) {
    const doc = docs.get(roomId);
    if (!doc) {
      // Doc was evicted; persistence.writeState already snapshotted it.
      clearDirty(roomId);
      continue;
    }
    try {
      const state = Y.encodeStateAsUpdate(doc);
      await saveSnapshot(roomId, state);
      clearDirty(roomId);
    } catch (err) {
      console.error(`[snapshot-worker] failed for ${roomId}:`, err);
      // Keep dirty; next tick will retry.
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
