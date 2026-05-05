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

## Phase 2 — Persistence Layer

- [ ] `apps/ws` y-websocket server (Node.js, ARM-compatible)
- [ ] `y-leveldb` adapter, volume-mounted at `/data/yjs`
- [ ] Snapshot worker:
  - [ ] Debounced 30s tick → `Y.encodeStateAsUpdate` → BLOB into `room_snapshots`
  - [ ] On last-client-disconnect → final snapshot
  - [ ] Update `rooms.last_accessed_at` on every connect
- [ ] Boot path: load latest snapshot from Oracle DB if LevelDB entry missing (disaster recovery)

## Phase 3 — Self-hosted Piston

- [ ] `engineer-man/piston` Docker image (verify ARM64 support; fallback: build from source)
- [ ] Internal-only network exposure (no public port)
- [ ] Pre-install language packages on first boot (Python, Node, Go, Java, C++)
- [ ] Next.js API route `/api/run` → Piston `/api/v2/execute`
- [ ] UI: stdin textarea, stdout/stderr panel, runtime display
- [ ] Per-IP rate limiting on `/api/run`

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
