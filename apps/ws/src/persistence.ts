import fs from "node:fs";
import { createRequire } from "node:module";
import {
  ensureRoom,
  getLatestSnapshot,
  saveSnapshot,
  touchRoomAccess,
} from "@piepad/db";
import type { Persistence } from "y-websocket/bin/utils";
import type * as YType from "yjs";
import type * as YLeveldbType from "y-leveldb";

// y-websocket/bin/utils is CJS. y-leveldb is dual-package (its ESM entry
// imports yjs as ESM, yielding a second module instance that breaks Yjs's
// constructor identity checks). Force both yjs and y-leveldb through the CJS
// require chain so we share one module cache with y-websocket internals.
const requireCjs = createRequire(import.meta.url);
const Y: typeof YType = requireCjs("yjs");
const { LeveldbPersistence } =
  requireCjs("y-leveldb") as typeof YLeveldbType;

const LEVELDB_PATH = process.env.LEVELDB_PATH ?? "./data/yjs";
fs.mkdirSync(LEVELDB_PATH, { recursive: true });

const ldb = new LeveldbPersistence(LEVELDB_PATH);

const dirtyRooms = new Set<string>();

export function getDirtyRooms(): ReadonlySet<string> {
  return dirtyRooms;
}

export function clearDirty(roomId: string): void {
  dirtyRooms.delete(roomId);
}

async function hydrateFromOracle(
  roomId: string,
  ydoc: YType.Doc
): Promise<boolean> {
  try {
    const snapshot = await getLatestSnapshot(roomId);
    if (!snapshot) return false;
    Y.applyUpdate(ydoc, snapshot);
    await ldb.storeUpdate(roomId, snapshot);
    return true;
  } catch (err) {
    console.error(`[persistence] Oracle hydrate failed for ${roomId}:`, err);
    return false;
  }
}

// Y.encodeStateAsUpdate of an empty Y.Doc returns a 2-byte sentinel; anything
// larger means the doc actually has content.
const EMPTY_STATE_BYTES = 2;

export const persistence: Persistence = {
  provider: ldb,
  async bindState(roomId, ydoc) {
    const persisted = await ldb.getYDoc(roomId);
    let persistedState = Y.encodeStateAsUpdate(persisted);

    if (persistedState.byteLength <= EMPTY_STATE_BYTES) {
      const recovered = await hydrateFromOracle(roomId, persisted);
      if (recovered) {
        persistedState = Y.encodeStateAsUpdate(persisted);
      }
    }

    // y-websocket registers the Y.Doc in its `docs` Map *before* awaiting
    // bindState, so a reconnecting client can already sync updates into
    // `ydoc` while we are still loading from LevelDB/Oracle above. Capture
    // them now and persist explicitly — without this, those updates land
    // only in memory and are lost on the next server restart, and a
    // subsequent writeState may even overwrite a good snapshot with the
    // pre-sync empty state.
    const liveUpdates = Y.encodeStateAsUpdate(ydoc);
    if (liveUpdates.byteLength > EMPTY_STATE_BYTES) {
      await ldb.storeUpdate(roomId, liveUpdates);
      dirtyRooms.add(roomId);
    }

    Y.applyUpdate(ydoc, persistedState);

    ydoc.on("update", (update: Uint8Array) => {
      ldb.storeUpdate(roomId, update).catch((err) => {
        console.error(
          `[persistence] LevelDB store failed for ${roomId}:`,
          err
        );
      });
      dirtyRooms.add(roomId);
    });

    void ensureRoom(roomId)
      .then(() => touchRoomAccess(roomId))
      .catch((err) => {
        console.error(
          `[persistence] ensureRoom/touch failed for ${roomId}:`,
          err
        );
      });
  },

  async writeState(roomId, ydoc) {
    try {
      const state = Y.encodeStateAsUpdate(ydoc);
      // Brief connect/disconnect before sync completes leaves an empty doc
      // here — refuse to clobber an existing good Oracle snapshot.
      if (state.byteLength <= EMPTY_STATE_BYTES) {
        dirtyRooms.delete(roomId);
        return;
      }
      await saveSnapshot(roomId, state);
      dirtyRooms.delete(roomId);
    } catch (err) {
      console.error(
        `[persistence] writeState snapshot failed for ${roomId}:`,
        err
      );
    }
  },
};

export async function closeLeveldb(): Promise<void> {
  await ldb.destroy();
}
