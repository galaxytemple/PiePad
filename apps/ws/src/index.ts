import "./env.js";

import { closePool } from "@piepad/db";
import crypto from "node:crypto";
import http from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { setPersistence, setupWSConnection } from "y-websocket/bin/utils";
import { authorizeUpgrade } from "./auth.js";
import { evictRoom } from "./evict.js";
import { closeLeveldb, persistence } from "./persistence.js";
import {
  drainOnShutdown,
  startSnapshotWorker,
  stopSnapshotWorker,
} from "./snapshot-worker.js";

setPersistence(persistence);
startSnapshotWorker();

const PORT = Number(process.env.WS_PORT ?? 1234);
const HOST = process.env.WS_HOST ?? "0.0.0.0";
const INTERNAL_SECRET = process.env.AUTH_SECRET ?? "";

function timingSafeSecretMatch(provided: string): boolean {
  if (
    INTERNAL_SECRET.length === 0 ||
    provided.length !== INTERNAL_SECRET.length
  ) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(provided),
    Buffer.from(INTERNAL_SECRET)
  );
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/internal/evict") {
    const provided = req.headers["x-internal-secret"];
    const providedStr = typeof provided === "string" ? provided : "";
    if (!timingSafeSecretMatch(providedStr)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = (await readJsonBody(req)) as {
        roomId?: string;
        reason?: string;
      };
      if (!body.roomId) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "missing_roomId" }));
        return;
      }
      const result = await evictRoom(body.roomId, body.reason ?? "deleted");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      console.error("[/internal/evict] failed", err);
      res.writeHead(500);
      res.end();
    }
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

function rejectUpgrade(socket: Duplex, statusLine: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${statusLine}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
    );
  } catch {
    // socket may already be torn down — fall through to destroy
  }
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  authorizeUpgrade(req)
    .then((result) => {
      if (!result.ok) {
        const statusLine =
          result.reason === "bad_room_id"
            ? "400 Bad Request"
            : "401 Unauthorized";
        rejectUpgrade(socket, statusLine);
        return;
      }
      wss.handleUpgrade(req, socket, head, (conn) => {
        wss.emit("connection", conn, req);
      });
    })
    .catch((err) => {
      console.error("[ws-upgrade] failed", err);
      rejectUpgrade(socket, "500 Internal Server Error");
    });
});

wss.on("connection", (conn, req) => {
  setupWSConnection(conn, req, { gc: true });
});

server.listen(PORT, HOST, () => {
  console.log(`piepad-ws listening on http://${HOST}:${PORT}`);
});

const SHUTDOWN_DRAIN_MS = Number(process.env.WS_SHUTDOWN_DRAIN_MS ?? 5_000);

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`piepad-ws received ${signal}, shutting down`);
  // Stop the periodic timer so it doesn't race with the final drain below.
  stopSnapshotWorker();
  // Stop accepting new HTTP/WS connections; in-flight ones keep going.
  server.close();
  // Disconnect clients — y-websocket fires writeState on the last-disconnect,
  // which snapshots one room at a time.
  for (const client of wss.clients) {
    client.close();
  }
  // Anything that didn't catch a writeState (e.g., zombie dirty entry, slow
  // Oracle round-trip in flight) gets a final shot here. Bounded so SIGTERM
  // can still progress to exit within Docker's stop-grace-period.
  await drainOnShutdown(SHUTDOWN_DRAIN_MS).catch((err) => {
    console.error("[shutdown] drain failed", err);
  });
  await closeLeveldb().catch(() => {});
  await closePool().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
