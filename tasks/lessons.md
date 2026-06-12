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

### oracledb Thin chokes on some MERGE shapes — prefer UPDATE-then-INSERT
- **Symptom**: `ORA-00923: FROM keyword not found where expected` on a MERGE
  statement that parses fine in SQL Developer / DBeaver. Stack points at
  the `conn.execute` call, not the SQL.
- **Cause**: oracledb's Thin SQL parser/binder can mangle MERGE statements
  that re-use bind names across the USING SELECT and the INSERT/UPDATE
  branches (e.g. `:userId` referenced both in `SELECT :userId AS uid FROM
  dual` and `VALUES (:userId, ...)`). The error message is opaque because
  the rewriting happens before Oracle ever sees the SQL.
- **Fix**: for two-row idempotent upserts, just do an UPDATE first and
  INSERT only if `rowsAffected === 0`. Two round-trips, plain ANSI, no
  bind aliasing tricks. (Pure-INSERT MERGEs without bind reuse, like our
  `ensureRoom`, are unaffected.)

### `FETCH FIRST :n ROWS ONLY` with a bind in oracledb Thin is brittle
- **Symptom**: same `ORA-00923` family of parse errors, this time on
  pagination queries.
- **Fix**: clamp `n` server-side and interpolate it as a literal — the
  number is server-controlled so there's no injection surface. Reserve
  binds for actual user input.

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

## Yjs collaborative editing

### y-monaco emits decoration class names but ships no CSS for them
- **Symptom**: Yjs sync clearly works (typing in tab A appears in tab B)
  and awareness state is updated, but you never see a remote caret or
  selection highlight in the editor.
- **Cause**: `y-monaco`'s `MonacoBinding` adds Monaco decorations with
  the classes `yRemoteSelection`, `yRemoteSelectionHead`,
  `.yRemoteSelection-<clientId>`, `.yRemoteSelectionHead-<clientId>`,
  but the package doesn't bundle CSS for any of them. Without rules,
  the elements collapse to zero pixels.
- **Fix**: drop a base block in your global CSS for the un-suffixed
  classes (caret bar, selection background) and inject per-clientID
  rules dynamically from awareness so each remote user gets their own
  colour + initial badge:
  ```ts
  const styleEl = document.createElement("style");
  document.head.appendChild(styleEl);
  awareness.on("change", () => {
    styleEl.textContent = [...awareness.getStates()].map(([id, s]) => `
      .yRemoteSelection-${id} { background: ${s.user.color}55 }
      .yRemoteSelectionHead-${id}::after { content: '${initial(s.user.name)}'; background: ${s.user.color} }
    `).join("");
  });
  ```

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

### Docker Desktop on macOS breaks nsjail; OrbStack just works
- **Symptom**: `Cannot run proxy, clone failed: Invalid argument` from
  every Piston execute, even with `privileged: true`,
  `seccomp=unconfined`, `apparmor=unconfined`, `cap_add: SYS_ADMIN`,
  `userns_mode: host`, and tmpfs jobs dir all in place.
- **Cause**: Docker Desktop's LinuxKit VM (especially under the Apple
  Virtualization framework on Apple Silicon) doesn't expose all the kernel
  namespace primitives nsjail clones, no matter how the container is
  configured. The same compose works as-is on a native Linux host.
- **Fix**: replace Docker Desktop with OrbStack on dev machines. It's a
  drop-in for `docker` / `docker compose`, ships a more permissive Linux
  VM, and runs nsjail correctly. Production (OCI A1 ARM Linux) doesn't
  need any of this — just `apt install docker.io`.

### `/piston/jobs` must be tmpfs, not a regular volume
- **Symptom**: every execute request returns 500 with body
  `Cannot run proxy, clone failed: Invalid argument` — Piston starts and
  serves /api/v2/runtimes fine, but no job ever runs.
- **Cause**: nsjail clones a new mount namespace and bind-mounts the job's
  scratch directory. It expects the filesystem under /piston/jobs to be
  exec-able and to support the mount flags it needs (uid, gid, mode). A
  Docker named volume is backed by overlayfs whose flags nsjail can't
  fully replicate, so the clone() syscall fails with EINVAL.
- **Fix**: mount `/piston/jobs` as tmpfs with the upstream-recommended
  options:
  ```yaml
  tmpfs:
    - /piston/jobs:exec,uid=1000,gid=1000,mode=711
  ```

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

### Re-derive identity inside server actions, never trust closure-captured ids
- **Why**: Next.js server actions encode closure variables into a signed
  POST payload, so a captured `userId` is technically tamper-resistant. But
  any future refactor that also reads form input, or any framework-level
  CSRF lapse, can blow that assumption up. The defensive pattern is cheap.
- **Pattern**: every `"use server"` mutation re-runs `auth()` and re-derives
  `userId` from the session before doing the write:
  ```ts
  async function saveX(form: FormData) {
    "use server";
    const session = await auth();
    if (!session?.user?.id) throw new Error("unauthorized");
    const userId = Number(session.user.id);
    if (!Number.isInteger(userId)) throw new Error("invalid session");
    await dbWrite(userId, ...);
  }
  ```
- This also means DB-layer functions like `updateUserNickname(id, ...)` do
  not need to do their own auth — the boundary is the server action.

### Plain `<a href>` for internal navigation kills React after back-nav
- **Symptom**: After clicking a link to another route in the app and then
  using the browser back button, every interactive element on the
  restored page goes dead. Buttons show their CSS `:active` state when
  pressed (so the click is reaching the DOM) but their React `onClick`
  handlers never fire — even programmatic
  `document.querySelector('button').click()` does nothing. A hard refresh
  fixes everything until the next round-trip.
- **Cause**: A `<a href="/somewhere">` in App Router is a *full browser
  navigation*, not an SPA transition. The browser caches the page in its
  back-forward cache (bfcache); on back, the DOM is restored but React's
  event delegation root no longer matches the document — clicks bypass
  React entirely.
- **Fix**: use `<Link>` from `next/link` for every internal route. Stays
  in client-side routing, no bfcache, React stays attached.
- **What didn't help (red herrings)**: switching the buttons from
  HeroUI/react-aria to plain `<button>`, disabling the holy-loader
  progress bar, `export const dynamic = "force-dynamic"`, configuring
  `experimental.staleTimes`. The interactive tree wasn't broken — the
  navigation was.
- **Detection trick**: programmatic `.click()` on the dead button. If
  even that doesn't fire React's onClick, the entire React event system
  has been disconnected from the document — strongly hints at a
  navigation/cache layer issue, not anything in the component.

---

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

## Bash

### `cd && exec <bare-name>` is dangerous when the cwd shadows PATH

- **Symptom**: `./scripts/dc up -d` fails inside SSH with
  `exec: docker: cannot execute: Is a directory`. The same script works
  fine in an interactive shell.
- **Cause**: After `cd "$(dirname "$0")/.."` the cwd is the repo root,
  which contains a `docker/` directory. Non-interactive SSH sessions
  often start with a stripped/empty PATH; when `exec docker compose ...`
  runs in a shell with no usable PATH, `docker` resolves to the local
  `docker/` directory and the kernel rejects exec'ing a directory.
- **Fix**: Resolve the binary to an absolute path *before* `cd`:
  ```bash
  DOCKER_BIN="$(command -v docker || echo /usr/bin/docker)"
  cd "$(dirname "$0")/.."
  exec "$DOCKER_BIN" compose ...
  ```
- **General rule**: any time a script does `cd` followed by `exec <bare>`,
  capture the absolute path first. PATH is not guaranteed and the cwd can
  silently win.

## Auth.js v5

### Behind a reverse proxy, `AUTH_TRUST_HOST=true` and `AUTH_URL` are both required

- **Symptom**: After deploying behind Caddy/nginx, the browser hits
  `ERR_TOO_MANY_REDIRECTS` on every page. Container logs show
  `[auth][error] UntrustedHost: Host must be trusted. URL was: https://<public host>/api/auth/session`.
  Sometimes the `/login` page itself redirects to `/`, sometimes the
  user lands on `https://0.0.0.0:3000/api/auth/error?error=Configuration`.
- **Cause**: Caddy terminates TLS and forwards to `web:3000` over HTTP.
  Inside the container the request `Host` header is the internal service
  name, so Auth.js v5 (which refuses unknown hosts in production by
  default) throws `UntrustedHost` on every `auth()` call. The throw
  bubbles into the proxy/middleware redirect logic and creates a loop.
  Even after `AUTH_TRUST_HOST=true` quiets the throw, Auth.js needs a
  canonical absolute URL to build OAuth callback / error / signin
  redirect pages — without `AUTH_URL` it falls back to the container's
  listen address (`0.0.0.0:3000`) and sends users to broken URLs.
- **Fix**: set both in the production env:
  ```
  AUTH_TRUST_HOST=true
  AUTH_URL=https://${PUBLIC_HOST}
  ```
  Local Playwright tests don't catch this because they hit the dev server
  directly with no proxy. Add both to `.env.example` and to the deploy
  pipeline's secret-built `.env`.

## node-oracledb

### Pool `sessionCallback` (async form) hangs connection acquisition in 6.6

- **Symptom**: every request times out with
  `NJS-040: connection request timeout. Request exceeded "queueTimeout" of 60000`.
  Local dev was fine because the callback wasn't installed there
  (no `ORACLE_SCHEMA` set → branch was skipped).
- **Cause**: oracledb 6.6's `sessionCallback` option, when given an async
  function returning a Promise, fails to release the connection back to
  the pool after the callback resolves. Subsequent `getConnection()`
  calls queue forever and eventually hit `queueTimeout`.
- **Fix**: drop `sessionCallback` and run the per-session setup inside
  the wrapper that checks out a connection:
  ```ts
  export async function withConnection<T>(fn: (c: Connection) => Promise<T>) {
    const conn = await (await getPool()).getConnection();
    try {
      const schema = process.env.ORACLE_SCHEMA;
      if (schema) {
        await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${schema}`);
      }
      return await fn(conn);
    } finally {
      await conn.close();
    }
  }
  ```
  One extra round-trip per checkout, can't hang the pool, works
  regardless of how oracledb resolves callback signatures internally.

### Login user vs. table-owner schema: `ALTER SESSION SET CURRENT_SCHEMA` only changes name resolution

- **Symptom**: queries hit `ORA-00942: table or view "<LOGIN_USER>"."<TABLE>" does not exist`
  even though the table clearly exists in another schema.
- **Cause**: Oracle resolves unqualified table names against the connected
  user's schema by default. When app code expects `users` to live in
  `APP_PROD_SCHEMA` but the login user is `APP_PROD_USER`, the resolution
  goes to `APP_PROD_USER.users` (which doesn't exist).
- **Fix**: per session, run `ALTER SESSION SET CURRENT_SCHEMA = APP_PROD_SCHEMA`.
  This only flips the default name-resolution schema — it does *not*
  grant any privileges. The login user still needs DML grants on the
  owner schema's objects. With Oracle 23ai, prefer the schema-level
  privilege form so new tables added by future migrations are auto-covered:
  ```sql
  GRANT SELECT ANY TABLE   ON SCHEMA APP_PROD_SCHEMA TO APP_PROD_DML_ROLE;
  GRANT INSERT ANY TABLE   ON SCHEMA APP_PROD_SCHEMA TO APP_PROD_DML_ROLE;
  GRANT UPDATE ANY TABLE   ON SCHEMA APP_PROD_SCHEMA TO APP_PROD_DML_ROLE;
  GRANT DELETE ANY TABLE   ON SCHEMA APP_PROD_SCHEMA TO APP_PROD_DML_ROLE;
  GRANT APP_PROD_DML_ROLE TO APP_PROD_USER;
  ```
  Note: `READ ANY TABLE` ≠ `SELECT ANY TABLE`. `READ` cannot lock rows
  (no `SELECT FOR UPDATE`); some queries inside transactions still demand
  `SELECT`. Grant `SELECT` to be safe, and `READ` is redundant once you do.

## Piston

### Public emkc.org API is whitelist-only as of 2026-02-15

- **Symptom**: `/api/run` returns 502 with body
  `{"message":"Public Piston API is now whitelist only as of 2/15/2026.
  Please contact EngineerMan on Discord with use case justification or
  consider hosting your own Piston instance."}` (HTTP 401 from emkc).
- **Cause**: policy change. Anonymous public access ended.
- **Fix**: self-host. PiePad's pattern: a separate small VM (1GB E2 is
  fine for python+typescript only) running just the Piston container,
  reachable from the app VM over a private (or SL-restricted public)
  IP at `http://<piston-host>:2000/api/v2`. The `runtime` profile in
  `docker/docker-compose.yml` is the local-dev variant; production uses
  a standalone `docker run` on the dedicated host so the app stack
  doesn't pull in the Piston image.

### Public Piston response shape differs from self-host — parse defensively

- **Symptom**: `/api/run` crashes on `result.run.stdout` because `run`
  is undefined. Or rejected requests return HTTP 200 with
  `{"message": "..."}` and no `run` block.
- **Cause**: emkc.org's public API surface diverges from the OSS
  Piston server in a few places: `run_timeout`/`compile_timeout` are
  capped at 3000ms (anything larger gets a 400), validation errors
  come back as HTTP 200 + `{message}` rather than 4xx, and some
  responses omit the `compile` stream entirely.
- **Fix**: in `apps/web/src/app/api/run/route.ts` —
  - clamp `run_timeout`/`compile_timeout` to 3000ms when `PISTON_URL`
    contains `emkc.org`,
  - read the body once as text so the same buffer covers JSON-parse
    failures and shape mismatches,
  - treat `{message}` at HTTP 200 as `piston_rejected`,
  - treat valid JSON missing `run` as `piston_invalid_response`,
  - default every field through helpers (`pickString`, `pickIntOrNull`,
    `pickStringOrNull`) so a missing key never crashes the route.
  Now obsolete since we self-host, but keep the guards — they're cheap
  and protect against any future upstream wobble.

## CI/CD & Deploy (2026-06-11)

### Build images in CI, never on a 1GB production box

- **Symptom**: `배포가 안되네` — `docker compose up --build` on the OCI
  E2.1.Micro (1GB) compiled Next.js for ~7.7 min and the deploy SSH session
  died mid-build (`client_loop: send disconnect: Broken pipe`).
- **Fix**: build `web`/`ws`/`cleanup` in GitHub Actions (4 vCPU/16GB runner),
  push to GHCR, and on the box only `docker compose pull && up -d`. The box
  never compiles. GitHub-hosted runners are far bigger than the free VM.

### `docker/build-push-action` needs `push: true`

- Default is `push: false` — it builds but does NOT push. The box's later
  `docker compose pull` then fails with `manifest/reference not found`. Always
  set `push: true` when publishing to a registry. (Cost us one deploy cycle.)

### Piston is amd64-only — an ARM A1 cannot host it

- `ghcr.io/engineer-man/piston` and its language packages have no arm64 build.
  On an OCI A1 (Ampere/ARM) the container crashes with `exec format error`.
  Piston must stay on the x86 box. We reverted an A1 split and co-located it on
  the E2 via the compose `runtime` profile.

### `PISTON_URL` inside compose uses the service name, not 127.0.0.1

- From inside the `web` container, `127.0.0.1:2000` is the web container
  itself → `piston_unreachable`. Use the docker network service name:
  `http://piston:2000/api/v2`. The host-loopback publish (`127.0.0.1:2000`)
  is only so the box itself can run `install-piston-langs.sh`.

### Piston ships with zero languages — install once, persists in a volume

- After first `up`, no runtimes exist (`"python-* runtime is unknown"`).
  Install via the package API (`scripts/install-piston-langs.sh`); the
  `piston_packages` named volume keeps them across redeploys.

## React / Next.js

### eslint-plugin-react-hooks v7 forbids setState-in-effect & ref-in-render

- v7 (React Compiler-aware) rejects "reset state in a useEffect when a prop
  changes" and reading `ref.current` during render. To reset child state when a
  prop changes, give the child a `key` derived from that prop (parent re-mounts
  it) instead of an effect. For a genuinely-safe ref read during render
  (re-render guaranteed by a co-located state update), a narrowly-scoped
  `// eslint-disable-next-line react-hooks/refs` with a why-comment is fine.

---

## Graph DSL / Directive Parsing

### Unknown attr mid-chain silently drops earlier attrs in the same directive

- **Symptom**: `color:16:info:x` on an edge applies neither the color nor the
  label. No error is thrown; both attrs are silently discarded.
- **Cause**: `parseDecoChain` walks tokens left-to-right. When it hits an
  unrecognized token it rejects the rest of the chain and returns early,
  discarding already-parsed values accumulated before the bad token.
- **Fix**: on an unrecognized token, break out of the chain loop with the
  accumulated attrs intact (partial-match semantics), or emit a parse warning
  and skip only the bad token. Never discard prior valid attrs because a later
  token is unknown. Write a test: `color:16:bogus` should still apply color 16.

### `color:0` → empty string for theme-aware "no color"

- **Pattern**: map color index 0 → `""` in `resolveColor`, then in the renderer
  use `element.data("color") || themedDefault`. This lets a directive explicitly
  reset a node/edge to the current theme's default color without hard-coding any
  hex — the fallback is evaluated at render time so theme switches still work.

### Per-step narration: attach to a graph header, not a global footer

- **Symptom**: `graph_info:` messages placed in a footer below the step bar are
  clipped on short viewports and visually bleed into node-info output
  (`d:5`/`low:3` showing through).
- **Fix**: render per-step messages directly under the `[@id]` graph header.
  Each graph owns its own message strip; the strip is only visible when there is
  a message for the current step.

### "Sticky at-or-before" display pattern for sparse per-step annotations

- **Context**: a directive that fires on step 3 should remain visible on steps
  4, 5, … until replaced or cleared, rather than vanishing after step 3.
- **Pattern**:
  ```ts
  // messages: Record<graphId, Record<step, string>>
  function messageFor(messages: Record<string, Record<number, string>>, id: string, step: number): string {
    const byStep = messages[id];
    if (!byStep) return "";
    const steps = Object.keys(byStep).map(Number).filter(s => s <= step).sort((a, b) => b - a);
    return steps.length ? byStep[steps[0]] : "";
  }
  ```
  The helper returns the most-recent message whose step is ≤ the current step.
  An empty string at step N explicitly clears the message from that step forward.

### Non-event directives: parse to a union type, dispatch separately

- **Pattern**: when a directive (e.g. `graph_info:`) does not consume an
  animation step, model it as a separate union arm in the parse result
  (`GraphEvent | InfoDirective`) and handle it in the program dispatcher rather
  than pushing it onto the event queue. This keeps the step counter correct and
  avoids off-by-one shifts in all subsequent events.

---

## Piston

### `PISTON_OUTPUT_MAX_SIZE` defaults to 1024 bytes — raise it for verbose programs

- **Symptom**: `/api/run` returns a result with `stdout` truncated and a
  `"stdout length exceeded"` message appended, even for programs that produce
  only a few KB of output.
- **Cause**: engineer-man/piston caps combined stdout+stderr at
  `PISTON_OUTPUT_MAX_SIZE` bytes (default 1024). The container silently
  truncates at that boundary.
- **Fix**: set `PISTON_OUTPUT_MAX_SIZE=65536` (or higher) in the Piston
  container's environment. Recreate the container to apply.
