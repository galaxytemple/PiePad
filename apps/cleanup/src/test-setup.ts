// AUTH_SECRET is needed by the ws-internal evict call (HMAC header).
process.env.AUTH_SECRET ??=
  "test-secret-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
