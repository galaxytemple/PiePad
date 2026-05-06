declare module "y-leveldb" {
  import type * as Y from "yjs";

  export class LeveldbPersistence {
    constructor(location: string);
    getYDoc(docName: string): Promise<Y.Doc>;
    storeUpdate(docName: string, update: Uint8Array): Promise<number>;
    flushDocument(docName: string): Promise<number>;
    clearDocument(docName: string): Promise<void>;
    destroy(): Promise<void>;
  }
}

declare module "y-websocket/bin/utils" {
  import type { IncomingMessage } from "node:http";
  import type { WebSocket } from "ws";
  import type * as Y from "yjs";

  export interface Persistence {
    bindState: (docName: string, ydoc: Y.Doc) => Promise<void> | void;
    writeState: (docName: string, ydoc: Y.Doc) => Promise<void> | void;
    provider?: unknown;
  }

  export const docs: Map<string, Y.Doc>;

  export function setPersistence(persistence: Persistence | null): void;
  export function getPersistence(): Persistence | null;

  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    options?: { docName?: string; gc?: boolean }
  ): void;
}
