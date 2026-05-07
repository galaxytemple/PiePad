import { createRequire } from "node:module";
import { docs } from "y-websocket/bin/utils";
import type * as YType from "yjs";
import {
  clearDirty,
  dropLeveldbDoc,
  markEvicting,
  unmarkEvicting,
} from "./persistence.js";

const requireCjs = createRequire(import.meta.url);
const Y: typeof YType = requireCjs("yjs");

// Brief grace period after marking the room as deleted so connected clients
// have time to receive the meta.deleted update before we drop the socket.
const EVICT_DELAY_MS = 1500;

export interface EvictResult {
  hadActiveDoc: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Order matters: mark evicting *before* anything else so the snapshot worker
// stops considering the room. Drop LevelDB *after* sockets are closed so
// late-arriving updates can't recreate the LevelDB document under the same key.
async function evictionTail(roomId: string): Promise<void> {
  try {
    const stillThere = docs.get(roomId);
    if (stillThere) {
      for (const conn of stillThere.conns.keys()) {
        conn.close?.();
      }
    }
    await dropLeveldbDoc(roomId);
    clearDirty(roomId);
  } finally {
    unmarkEvicting(roomId);
  }
}

export async function evictRoom(
  roomId: string,
  reason: string
): Promise<EvictResult> {
  markEvicting(roomId);

  const doc = docs.get(roomId);
  const hadActiveDoc = !!doc;

  if (doc) {
    const meta = doc.getMap("meta");
    if (!meta.has("deleted")) {
      meta.set("deleted", { reason, at: Date.now() });
    }
    Y.transact(doc, () => {
      /* synthetic flush */
    });
    // Defer the rest so the HTTP caller (cleanup cron) doesn't block 1.5s
    // per room. unmarkEvicting always runs in evictionTail's finally.
    void delay(EVICT_DELAY_MS).then(() => evictionTail(roomId));
  } else {
    // Dormant room — no clients to notify, drop immediately.
    await evictionTail(roomId);
  }

  return { hadActiveDoc };
}
