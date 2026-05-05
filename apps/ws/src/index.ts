import http from "node:http";
import { WebSocketServer } from "ws";
import { setupWSConnection } from "y-websocket/bin/utils";

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

const shutdown = (signal: NodeJS.Signals) => {
  console.log(`piepad-ws received ${signal}, shutting down`);
  wss.close(() => {
    server.close(() => process.exit(0));
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
