import { createRequire } from "node:module";
import { docs } from "y-websocket/bin/utils";
import type * as YType from "yjs";
import { dropLeveldbDoc } from "./persistence.js";

const requireCjs = createRequire(import.meta.url);
const Y: typeof YType = requireCjs("yjs");

// Brief grace period after marking the room as deleted so connected clients
// have time to receive the meta.deleted update before we drop the socket.
const EVICT_DELAY_MS = 1500;

export interface EvictResult {
  hadActiveDoc: boolean;
}

export async function evictRoom(
  roomId: string,
  reason: string
): Promise<EvictResult> {
  const doc = docs.get(roomId);
  let hadActiveDoc = false;

  if (doc) {
    hadActiveDoc = true;
    const meta = doc.getMap("meta");
    if (!meta.has("deleted")) {
      meta.set("deleted", { reason, at: Date.now() });
    }
    Y.transact(doc, () => {
      /* synthetic flush */
    });
    // Drop sockets after the flush has had a chance to reach clients.
    setTimeout(() => {
      const stillThere = docs.get(roomId);
      if (!stillThere) return;
      for (const conn of stillThere.conns.keys()) {
        conn.close?.();
      }
    }, EVICT_DELAY_MS);
  }

  // LevelDB cleanup runs whether or not the doc was in memory — cleanup
  // cron will hit dormant rooms whose docs were already evicted.
  await dropLeveldbDoc(roomId);

  return { hadActiveDoc };
}
