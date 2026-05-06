import { createRequire } from "node:module";
import { docs } from "y-websocket/bin/utils";
import type * as YType from "yjs";

const requireCjs = createRequire(import.meta.url);
const Y: typeof YType = requireCjs("yjs");

// Brief grace period after marking the room as deleted so connected clients
// have time to receive the meta.deleted update before we drop the socket.
const EVICT_DELAY_MS = 1500;

export function evictRoom(roomId: string, reason: string): boolean {
  const doc = docs.get(roomId);
  if (!doc) return false;
  const meta = doc.getMap("meta");
  if (!meta.has("deleted")) {
    meta.set("deleted", { reason, at: Date.now() });
  }
  // Force-emit a synthetic update so reluctant providers flush immediately.
  Y.transact(doc, () => {
    /* noop */
  });
  setTimeout(() => {
    const stillThere = docs.get(roomId);
    if (!stillThere) return;
    for (const conn of stillThere.conns.keys()) {
      conn.close?.();
    }
  }, EVICT_DELAY_MS);
  return true;
}
