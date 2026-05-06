# Lessons Learned

Patterns captured from real failures during PiePad development. Re-read at the
start of related work to avoid repeating the same mistakes.

---

## Flyway

### Baseline silently skips your first migration
- **Symptom**: `pnpm db:migrate` reports `Schema version: 1` and Success, but no
  application tables are created. `flyway info` shows V1 as
  `Ignored (Baseline)` with a separate `Baseline` row also at V1.
- **Cause**: `flyway.baselineOnMigrate=true` combined with the default
  `flyway.baselineVersion=1` tells Flyway "treat V1 as already applied" —
  every migration `<= baselineVersion` is skipped.
- **Fix**: For greenfield projects, always set `flyway.baselineVersion=0` when
  `baselineOnMigrate=true` is used. With V0 baseline, V1+ all run.
- **Recovery when bitten**: drop `flyway_schema_history` in the target schema,
  fix the config, re-run migrate.

---

## Docker Compose

### `--env-file` is required when the compose file lives in a subdirectory
- **Symptom**: `WARN The "FOO" variable is not set. Defaulting to a blank string.`
  for variables that are clearly defined in project-root `.env`.
- **Cause**: Compose's default project directory is the directory of the first
  `-f` compose file. With `docker/docker-compose.yml`, it looks for
  `docker/.env`, not the project root.
- **Fix**: Pass `--env-file .env` explicitly in package.json scripts when the
  compose file is nested.

### `.env` does not recursively expand `${VAR}`
- **Symptom**: A composite var like
  `FLYWAY_URL=jdbc:oracle:thin:@${ORACLE_TNS_NAME}?...` is passed to the
  container literally, without `${ORACLE_TNS_NAME}` substituted.
- **Cause**: `.env` is parsed as plain `KEY=VALUE`. Compose only interpolates
  `${VAR}` references in the YAML, not inside `.env` values themselves.
- **Fix**: Build the composite value inline in the compose YAML's
  `environment:` block, referencing the simple atoms from `.env`. Don't
  duplicate composite values in `.env`.

---

## Oracle Autonomous Database

### Newly created users have no privileges to create tables
- **Symptom**: Migration fails with `ORA-01031: insufficient privileges` when
  Flyway tries to `CREATE TABLE "<USER>"."flyway_schema_history"`.
- **Cause**: ADB users created via `CREATE USER` only get login. They need
  privileges and a tablespace quota explicitly.
- **Fix**: As ADMIN, run:
  ```sql
  GRANT CONNECT, RESOURCE TO <user>;
  ALTER USER <user> QUOTA UNLIMITED ON DATA;
  ```
  Or `GRANT DWROLE TO <user>;` for the ADB convenience role.

### Wallet `sqlnet.ora` `?/network/admin` placeholder breaks in containers
- **Symptom**: `ORA-12578: TNS:wallet open failed` or similar SSL/wallet errors
  when running JDBC/oracledb from Docker.
- **Cause**: ADB-supplied `sqlnet.ora` uses
  `WALLET_LOCATION=...DIRECTORY="?/network/admin"` where `?` resolves to
  `$ORACLE_HOME` — undefined in slim Flyway/Node containers.
- **Fix**: Replace `?/network/admin` with the actual mounted wallet path
  (`/wallet`) before first use:
  ```sh
  sed -i.bak 's|?/network/admin|/wallet|' wallet/sqlnet.ora
  ```

---

## y-websocket persistence

### `bindState` is not awaited — capture live updates before applying persisted state
- **Symptom**: After a server restart, content typed before the crash
  appears to "vanish" on the next `writeState` (e.g. an empty Oracle
  snapshot replaces a good one), even though clients clearly had the data.
- **Cause**: y-websocket inserts the freshly created `Y.Doc` into its
  internal `docs` Map and starts the WS sync handshake **before** the
  Promise from `persistence.bindState` resolves. A reconnecting client can
  therefore push its updates into `ydoc` during the `await
  ldb.getYDoc(...)` window. If your `update` listener is attached only
  after the persisted state is loaded, those client updates land in memory
  but never hit LevelDB. A short connect/disconnect later, `writeState`
  encodes the still-empty (from the server's perspective) doc and writes it
  to Oracle, clobbering the previous good snapshot.
- **Fix**: inside `bindState`, after the async load completes, encode the
  current live `ydoc` and persist it explicitly before applying the
  persisted state and attaching the listener:
  ```ts
  const liveUpdates = Y.encodeStateAsUpdate(ydoc);
  if (liveUpdates.byteLength > 2) {
    await ldb.storeUpdate(roomId, liveUpdates);
  }
  ```

### Treat empty doc as "do not snapshot"
- **Symptom**: Same as above — the empty-doc snapshot wins and good data is
  lost after a brief connect/disconnect race.
- **Fix**: in both `writeState` and the periodic snapshot worker, skip the
  upsert when `Y.encodeStateAsUpdate(ydoc).byteLength <= 2` (the empty
  sentinel). Snapshots are inherently last-write-wins, so refusing to
  write empty preserves the most recent meaningful state.

---

## Node.js / ESM-CJS interop

### Dual-package libraries can silently load twice
- **Symptom**: `Yjs was already imported. This breaks constructor checks and
  will lead to issues!` printed at server start. Subtle bugs follow:
  `instanceof` checks across module boundaries return false, leading to
  malformed CRDT state or "expected Y.Doc" type errors.
- **Cause**: A library publishes both ESM (`"module": "..."` or
  `"exports": { "import": "..." }`) and CJS (`"main"` or
  `"exports": { "require": "..." }`) entry points. Node's ESM loader and CJS
  `require()` chain each instantiate the library separately. If one part of
  your app imports it via ESM and another via CJS (e.g. through a transitive
  dependency that uses `require`), you end up with two module instances
  sharing the same name and version.
- **Concrete trigger here**: `y-websocket/bin/utils.cjs` does
  `require("yjs")` (CJS). Our app initially did `import * as Y from "yjs"`
  (ESM) and `import { LeveldbPersistence } from "y-leveldb"` — and y-leveldb
  is itself dual-package, so its ESM entry pulled yjs's ESM entry.
- **Fix**: Force the ambiguous packages through `createRequire` so every
  caller hits the CJS module cache:
  ```ts
  import { createRequire } from "node:module";
  import type * as YType from "yjs";
  const requireCjs = createRequire(import.meta.url);
  const Y: typeof YType = requireCjs("yjs");
  const { LeveldbPersistence } =
    requireCjs("y-leveldb") as typeof import("y-leveldb");
  ```
- **Detection**: also surfaces as "yjs is loaded twice" / "package vendored"
  warnings, or weird transactional state issues. Suspect any time you mix
  Node ESM with libraries whose internals use `require`.

---

## Oracle Autonomous Database (continued)

### node-oracledb Thin mode cannot use `cwallet.sso` — needs the wallet password
- **Symptom**: `NJS-511: connection to listener at host ... port 1522 was
  refused. Cause: ORA-12506` from a Node.js process, while the same wallet,
  same TNS alias, same network, and same user work fine in DBeaver / Flyway /
  any JDBC client.
- **Cause**: The ADB wallet zip contains both `cwallet.sso` (autologin SSO)
  and `ewallet.p12` (encrypted PKCS#12). JDBC reads `cwallet.sso` and runs
  mTLS without prompting. node-oracledb in Thin mode (the default in v6+)
  ignores `cwallet.sso` and tries to open `ewallet.p12` — which is encrypted
  with the password the user picked when downloading the wallet from OCI.
  Without that password, Thin mode connects without a client certificate,
  the listener sees a non-mTLS attempt, and rejects with `ORA-12506`.
- **Fix**: pass `walletLocation` (the wallet directory) AND `walletPassword`
  (the wallet zip password) explicitly to `oracledb.createPool` /
  `oracledb.getConnection`:
  ```ts
  await oracledb.createPool({
    user, password, connectString,
    configDir: walletDir,
    walletLocation: walletDir,
    walletPassword: process.env.ORACLE_WALLET_PASSWORD, // required
  });
  ```
- **Alternative**: switch to Thick mode (`oracledb.initOracleClient()`),
  which does honor `cwallet.sso`. Costs an Instant Client install on every
  developer machine + container image.
- **Distraction to avoid**: the same `ORA-12506` is also produced by
  database service ACL filtering on the IP. If JDBC clients connect fine
  from the same machine, the network is OK — chase the wallet config.

---

## Piston

### Per-job timeouts the API enforces are *ceilings*, not defaults
- **Symptom**: `/api/run` returns 502 `piston_error` with body
  `{"message":"run_timeout cannot exceed the configured limit of 3000"}`
  the moment the client passes `run_timeout > 3000` (or
  `compile_timeout` similarly).
- **Cause**: Piston exposes `PISTON_RUN_TIMEOUT` /
  `PISTON_COMPILE_TIMEOUT` env vars on the container. They default to
  3000ms / 10000ms and act as **upper bounds** on whatever the request
  payload asks for. Anything larger is refused at the API layer before the
  process is ever launched.
- **Fix**: bump the env vars in compose so they sit above the largest value
  your app may legitimately send, e.g. `PISTON_RUN_TIMEOUT=30000`. Recreate
  the container (`pnpm piston:down && pnpm piston:up`) — env changes do
  not apply to existing containers.

---

## Node.js networking

### `localhost` from Node fetch refuses to Docker-published ports
- **Symptom**: `curl http://localhost:2000/whatever` works, but a Next.js
  API route fetching the same URL returns 502 (`piston_unreachable` /
  `ECONNREFUSED`) within ~25ms — far too fast for any real round trip.
- **Cause**: Node 17+ resolves `localhost` to `::1` (IPv6) before
  `127.0.0.1`. Docker Desktop's port-publishing only binds IPv4, so the
  IPv6 connection is refused. Node sometimes falls back to v4, but in
  practice (especially with undici/fetch) the refusal often surfaces
  unchanged. curl tries both addresses transparently, hiding the problem.
- **Fix**: hard-code `http://127.0.0.1:<port>` in any URL that targets a
  Docker-published service from a Node process. Reserve `localhost` for
  browser-side URLs.
- **Container case**: when the same Node service runs inside the compose
  network, point at the service name (`http://piston:2000`) instead. The
  IPv6 quirk only matters on the host loopback.

---

## Next.js (App Router)

### `'use client'` is not enough when an imported module touches `window` at top level
- **Symptom**: `ReferenceError: window is not defined at module evaluation` for
  a component marked `'use client'`. Stack points at an `import` line of a
  browser-only library (e.g. `y-monaco`, `monaco-editor`).
- **Cause**: Next.js still server-renders the initial HTML for Client
  Components, which means it imports their modules on the server. If any
  transitively imported module reads `window` at evaluation time, it crashes
  before any component code runs.
- **Fix**: Split the heavy component into an inner file and wrap it with
  `next/dynamic({ ssr: false })` from a tiny Client Component:
  ```tsx
  // Wrapper.tsx (Client Component)
  "use client";
  import dynamic from "next/dynamic";
  const Inner = dynamic(() => import("./Inner").then((m) => m.Inner), {
    ssr: false,
  });
  export function Wrapper(props) { return <Inner {...props} />; }
  ```
  Then the Server Component page imports `Wrapper`, and the browser-only
  module only loads in the browser.
- **Constraint**: `dynamic({ ssr: false })` must live inside a Client
  Component. Server Components can render the wrapper, but cannot call
  `dynamic` with `ssr: false` directly.
