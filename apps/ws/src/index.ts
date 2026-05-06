import "./env.js";

import { closePool } from "@piepad/db";
import http from "node:http";
import { WebSocketServer } from "ws";
import { setPersistence, setupWSConnection } from "y-websocket/bin/utils";
import { closeLeveldb, persistence } from "./persistence.js";
import {
  startSnapshotWorker,
  stopSnapshotWorker,
} from "./snapshot-worker.js";

setPersistence(persistence);
startSnapshotWorker();

const PORT = Number(process.env.WS_PORT ?? 1234);
const HOST = process.env.WS_HOST ?? "0.0.0.0";

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
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
