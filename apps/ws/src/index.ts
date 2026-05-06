import "./env.js";

import { closePool } from "@piepad/db";
import http from "node:http";
import { WebSocketServer } from "ws";
import { setPersistence, setupWSConnection } from "y-websocket/bin/utils";
import { evictRoom } from "./evict.js";
import { closeLeveldb, persistence } from "./persistence.js";
import {
  startSnapshotWorker,
  stopSnapshotWorker,
} from "./snapshot-worker.js";

setPersistence(persistence);
startSnapshotWorker();

const PORT = Number(process.env.WS_PORT ?? 1234);
const HOST = process.env.WS_HOST ?? "0.0.0.0";
const INTERNAL_SECRET = process.env.AUTH_SECRET ?? "";

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
    if (
      typeof provided !== "string" ||
      INTERNAL_SECRET.length === 0 ||
      provided !== INTERNAL_SECRET
    ) {
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
      const evicted = evictRoom(body.roomId, body.reason ?? "deleted");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, evicted }));
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

const wss = new WebSocketServer({ server });

wss.on("connection", (conn, req) => {
  setupWSConnection(conn, req, { gc: true });
});

server.listen(PORT, HOST, () => {
  console.log(`piepad-ws listening on http://${HOST}:${PORT}`);
});

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`piepad-ws received ${signal}, shutting down`);
  stopSnapshotWorker();
  for (const client of wss.clients) {
    client.close();
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await closeLeveldb().catch(() => {});
  await closePool().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
