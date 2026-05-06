// Tests need AUTH_SECRET (room-unlock signs cookies with it). Stub a stable
// fixture value so HMACs are deterministic.
process.env.AUTH_SECRET ??=
  "test-secret-deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
process.env.BCRYPT_ROUNDS ??= "4"; // keep bcrypt fast in tests
