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
- [x] One-shot installer `scripts/install-piston-langs.sh` (pinned versions
      for python / node / typescript / java / c++) wired as
      `pnpm piston:install`; ergonomics: `pnpm piston:up/down/logs`
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

## Phase 4 — Auth & Rooms (Google OAuth-only)

### 4.1 Schema (V3 migration)
- [ ] DROP `site_passwords` (site-password gate replaced by mandatory sign-in)
- [ ] DROP `admins` (replaced by `users` + `ADMIN_EMAILS` env allowlist)
- [ ] CREATE `users` (id, email UNIQUE, name, nickname, avatar_url,
      primary_provider, created_at, last_login_at)
- [ ] CREATE `user_oauth_accounts` (provider, provider_subject UNIQUE,
      provider_email, user_id FK) — multi-provider extension point
- [ ] CREATE `room_visits` (user_id, room_id PK pair, first_visited_at,
      last_visited_at, visit_count)
- [ ] ALTER `rooms`: drop `created_by_admin_id`, add `created_by_user_id` FK

### 4.2 Auth core (Auth.js v5 + Google)
- [ ] Install `next-auth@^5`, `@auth/core`, set `AUTH_SECRET`,
      `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- [ ] `/api/auth/[...nextauth]` route handler
- [ ] `signIn` callback upserts into `users` + `user_oauth_accounts`,
      stamps `last_login_at`
- [ ] JWT strategy; session carries `userId`, `email`, `nickname`,
      `avatarUrl`, `isAdmin`
- [ ] `ADMIN_EMAILS` env (comma-separated) → effective admin = email
      in list (no DB column needed for admin)
- [ ] `middleware.ts` redirects unauthenticated → `/login`
      (allowlist: `/login`, `/api/auth/*`, `/icon.svg`, `/apple-icon.png`)

### 4.3 Pages
- [ ] `/login` — Google sign-in button (extension slot for more providers)
- [ ] `/` — home dashboard: my rooms, visited rooms, "Create new pad" CTA
- [ ] `/pad/[roomId]` — same editor, awareness uses real nickname/avatar,
      room-password modal gate when room is private
- [ ] `/me` — profile (Google name + avatar read-only, nickname editable),
      sign-out
- [ ] `/admin/users` — admin-only user list (paginated, sortable)
- [ ] `/admin/rooms` — admin-only room list with delete

### 4.4 Room features
- [ ] Create-room modal: name + optional password
- [ ] Room owner toolbar in pad header: rename, delete, set/clear password
- [ ] Room password: bcrypt at rest; pad page asks for password when
      `password_hash IS NOT NULL` and grants short-lived cookie
- [ ] On every pad open: `room_visits` upsert + `last_visited_at` bump

### 4.5 Per-user rate limit
- [ ] `/api/run` token bucket key switched from IP to `userId`
      (still in-memory; Phase 7 swaps for Redis)

### 4.6 UI / animation
- [ ] Add `@heroui/react` + `framer-motion`; verify Tailwind v4 compat
- [ ] Wrap app in `HeroUIProvider`
- [ ] Replace plain Tailwind buttons/inputs/cards with HeroUI components
      (Button, Card, Avatar, Modal, Input, Listbox, Skeleton, Tooltip)
- [ ] framer-motion: page-transition fade, modal scale/fade,
      list stagger on the home dashboard
- [ ] Loading skeletons during fetches (rooms list, admin tables)

### 4.7 Setup checklist (operator)
- [ ] Create OAuth client in Google Cloud Console (Web application)
- [ ] Authorised redirect URIs:
      `http://localhost:3000/api/auth/callback/google`
      (later: `https://<host>/api/auth/callback/google`)
- [ ] Copy client ID/secret into `.env`
- [ ] Set `ADMIN_EMAILS=sanghoon@giboo.com[,...]`
- [ ] `pnpm db:migrate` to apply V3

## Phase 5 — Lifecycle Cleanup ✅

- [x] `apps/cleanup` long-running node-cron service (default `0 3 * * *` UTC,
      tunable via `CLEANUP_CRON`); catch-up sweep on start unless
      `CLEANUP_RUN_ON_START=false`. Single-flight guard so a slow run can't
      overlap the next tick.
- [x] `packages/db.listExpiredRooms(ttlDays)` queries
      `last_accessed_at < SYSTIMESTAMP - INTERVAL N DAY`; clamped 1..3650d
      and 1..5000 rows.
- [x] Each expired room: ws `/internal/evict` (broadcasts meta.deleted +
      drops LevelDB entry) → DELETE rooms (FK CASCADE wipes visits +
      snapshots) → INSERT `room_deletions` audit row with reason
      `30_DAY_INACTIVITY`.
- [x] `evictRoom` extended: persistence module exposes `dropLeveldbDoc` so
      eviction also clears LevelDB even when no doc was in memory (covers
      dormant rooms that never had an active connection during cleanup).
- [x] `pnpm cleanup:once` for ad-hoc runs / dry runs of the cron path.

## Phase 6 — Infra & CI/CD ✅

- [x] `docker/docker-compose.yml` default profile now boots prod stack:
      caddy + web + ws + cleanup. Piston in `runtime` profile (opt-in).
      Flyway in `tools` profile (one-shot).
- [x] `docker/Caddyfile` reverse-proxies `${PUBLIC_HOST}` (sslip.io) →
      web:3000 for the app, /yjs/* (prefix-stripped) → ws:1234 for the
      WebSocket. Auto-HTTPS via Let's Encrypt http-01.
- [x] `docker/{web,ws,cleanup}.Dockerfile` multi-stage builds. ws image
      includes python3/make/g++ for leveldown's node-gyp pass; web uses
      Next.js standalone output.
- [x] `.dockerignore` strips node_modules / .next / wallet / data / tests
      / docs from build contexts.
- [x] `.github/workflows/deploy.yml` triggers on push to main: SSH in,
      git reset --hard origin/main, docker compose up --build, run
      Flyway migrations, post-deploy curl smoke check. Concurrency
      group prevents overlapping deploys.
- [x] `docs/deploy.md` operator guide: host bootstrap, .env template,
      Google OAuth redirect URI, first-time migration, GH Actions
      secrets list, day-2 ops, Piston self-host ↔ public switch,
      troubleshooting matrix.

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
