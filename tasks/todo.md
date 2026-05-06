# Share-Pad Implementation Plan

Real-time collaborative notepad with code execution, deployed on OCI Free Tier.

---

## Architecture Snapshot

- **Single OCI ARM instance** (Ampere A1, user-provisioned via web console)
- **Docker Compose** orchestrates: `caddy`, `nextjs-app`, `y-websocket`, `piston`, `cleanup-cron`
- **Persistence (Option C — hybrid)**:
  - LevelDB on a Docker volume → real-time Yjs state per room (fast)
  - Oracle Autonomous DB → metadata + periodic Yjs binary snapshots (durable)
- **Access control**:
  - Site-level password gate (single shared password)
  - Per-room optional password
  - Admin-only room list + management
- **Lifecycle**: rooms persist forever unless inactive 30 days → auto-delete

---

## Phase 0 — Project Setup ✅

- [x] `pnpm` workspace skeleton (`apps/web` Next.js 16, `apps/ws`, `apps/cleanup`)
- [x] Shared `packages/db` module (skeleton; oracledb dep added — helpers land in Phase 2)
- [x] **Flyway** migration setup
  - [x] `db/migrations/V1__initial_schema.sql` with site_passwords / admins / rooms / room_snapshots / room_deletions
  - [x] `db/flyway.conf` (env-driven URL/user/password)
  - [x] Containerised Flyway runner via `docker/docker-compose.yml` (tools profile)
  - [x] `pnpm db:migrate` / `db:info` / `db:validate` scripts at root
- [x] `.env.example` covering Oracle wallet/TNS, JWT, BCRYPT_ROUNDS, WS, Piston, snapshot/TTL knobs
- [x] `.gitignore` (node_modules, .env, wallets, leveldb data, caddy data)
- [x] README with admin bootstrap SQL recipe

## Phase 1 — Real-time Editor (frontend) ✅

- [x] Next.js 16 app initialised in `apps/web`
- [x] Monaco Editor mounted via `@monaco-editor/react` (language picker deferred to Phase 3)
- [x] `yjs` + `y-monaco` + `y-websocket` client wiring with proper teardown
- [x] Awareness layer: random anon name + colour, active-user pill list, connection status badge
- [x] Room URL pattern: `/pad/[roomId]` (Next.js 16 async `params`)
- [x] Minimal y-websocket server in `apps/ws` (in-memory only — LevelDB/Oracle land in Phase 2)

## Phase 2 — Persistence Layer ✅

- [x] `packages/db` Oracle helper module: pool, withConnection, ensureRoom,
      touchRoomAccess, getLatestSnapshot, saveSnapshot (MERGE upsert)
- [x] V2 migration: UNIQUE(room_id) on room_snapshots so saveSnapshot upserts
      (one snapshot per room — periodic ticks would otherwise grow unbounded)
- [x] `y-leveldb` adapter, volume-mounted at `/data/yjs` (dev: `./data/yjs`)
- [x] Custom y-websocket Persistence wired via `setPersistence`:
  - [x] `bindState`: load LevelDB → fall back to Oracle snapshot if empty,
        subscribe to updates (LevelDB write + dirty marker), fire-and-forget
        ensureRoom + touchRoomAccess
  - [x] `writeState` on last-client-disconnect → final Oracle snapshot
- [x] Snapshot worker on `SNAPSHOT_INTERVAL_MS` (default 30s): iterate dirty
      docs from `y-websocket/bin/utils` `docs` Map, upsert via `saveSnapshot`
- [x] Boot path: cold-start recovery from Oracle when LevelDB has no entry
- [x] dotenv-loaded project-root `.env` via top-level side-effect import
- [x] CJS unification (`createRequire`) for `yjs` + `y-leveldb` to avoid the
      "Yjs was already imported" dual-instance warning

## Phase 3 — Self-hosted Piston ✅

- [x] `ghcr.io/engineer-man/piston:latest` (multi-arch, ARM64 OK) under
      compose `runtime` profile, privileged for nsjail, networking disabled
      for executed code, packages persisted in `piston_packages` volume
- [x] Dev port `2000` published; prod will reach piston only on the internal
      network via `PISTON_URL=http://piston:2000`
- [x] One-shot installer `scripts/install-piston-langs.sh` (pinned versions)
      wired as `pnpm piston:install`; ergonomics: `pnpm piston:up/down/logs`
- [x] Next.js API route `POST /api/run` → Piston `/api/v2/execute`,
      Zod-validated, AbortController-bounded, rate-limited per-IP
      (in-memory token bucket, default 10/min — Phase 7 swaps for Redis)
- [x] UI: shared language picker (Yjs `meta.language` Y.Map → all clients
      in a room see the same Monaco grammar), stdin one-liner, Run button,
      Clear button, output panel showing exit code / duration / compile
      stderr / stdout / stderr
- [x] Project-root `.env` shared by Next.js via `dotenv` in `next.config.ts`
      so `apps/web` and `apps/ws` read from the same source of truth
- [x] `NEXT_PUBLIC_WS_URL` plumbed through `.env.example`

## Phase 4 — Auth & Rooms

- [ ] `bcrypt` password hashing helper
- [ ] Site gate: middleware redirect to `/login` if no `site_session` cookie
- [ ] Admin login `/admin/login` → JWT in HTTP-only cookie
- [ ] **Admin bootstrap**: no app-level seeding — operator inserts row into `admins` table directly via SQL (document the bcrypt hash command in README)
- [ ] Room creation API with optional password
- [ ] Room access flow: URL → password prompt if hashed password set → grant `room_session` cookie
- [ ] Admin-only `/admin/rooms` list page (paginated, last-accessed sort)
- [ ] Admin actions: rename, delete, force-snapshot, reset password

## Phase 5 — Lifecycle Cleanup

- [ ] `apps/cleanup` cron container (runs daily at 03:00 UTC)
- [ ] Query rooms where `last_accessed_at < now - 30d` → delete row + LevelDB entry
- [ ] Cascade deletes `room_snapshots`
- [ ] Audit log table `room_deletions` for traceability

## Phase 6 — Infra & CI/CD

- [ ] `docker-compose.yml` (caddy / nextjs-app / y-websocket / piston / cleanup)
- [ ] Caddyfile — host bound to `<ip-with-dashes>.sslip.io`, automatic Let's Encrypt via http-01
- [ ] OCI Security List: open 80, 443; document procedure
- [ ] Caddy data volume mounted for cert persistence (survive container rebuilds + DNS hiccups)
- [ ] GitHub Actions workflow:
  - [ ] Build images
  - [ ] SSH into OCI host
  - [ ] `git pull` + `docker compose up -d --build`
  - [ ] Health-check curl after restart
- [ ] Secrets stored in GitHub Actions (SSH key, Oracle wallet base64)

## Phase 7 — Hardening (post-MVP)

- [ ] Backup job: Oracle DB export → OCI Object Storage weekly
- [ ] Observability: docker logs aggregation, simple uptime check
- [ ] Brute-force protection on site/room passwords (attempt counter + lockout)
- [ ] CSP / security headers via Caddy

---

## Open Questions Resolved

- Piston: **self-hosted** in Docker Compose (CI/CD-managed)
- Yjs persistence: **LevelDB + Oracle DB hybrid** (Option C)
- Access: **site password + optional room password + admin-only room list**
- Lifecycle: **30-day inactivity auto-delete**
- Infra: **single user-provisioned OCI ARM instance, multi-container via Compose**

## Pending Confirmations

- [ ] Oracle DB connection style (Wallet/mTLS) — assume Wallet for now
- [ ] Domain name + DNS pointing to OCI public IP
- [ ] GitHub repo creation (private?)
- [ ] Admin bootstrap method (env-seeded first admin, then UI-managed)

---

## Review Notes

_Filled in after implementation phases complete._
