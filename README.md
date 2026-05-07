# PiePad

Real-time collaborative notepad with code execution, deployed on Oracle Cloud Infrastructure (OCI) Free Tier.

## Stack
- Next.js 16 (App Router) + Monaco Editor
- Yjs + y-websocket (CRDT real-time sync)
- Auth.js v5 + Google OAuth
- Piston for code execution (self-hosted on a dedicated VM in production;
  the public emkc.org endpoint became whitelist-only on 2026-02-15 and
  is no longer used)
- Oracle Autonomous Database 23ai (mTLS) for metadata + Yjs snapshot
  persistence. Production splits the login user from the table-owner
  schema (e.g. `APP_PROD_USER` logs in, `APP_PROD_SCHEMA` owns the
  tables) for least-privilege at runtime
- LevelDB for hot Yjs state
- Caddy for HTTPS via `<ip>.sslip.io` + Let's Encrypt
- Docker Compose, deployed via GitHub Actions over SSH

## Workspace Layout

```
apps/
  web/      Next.js frontend + API routes
  ws/       y-websocket server (Yjs sync + snapshot worker)
  cleanup/  Daily cron job (30-day inactivity sweeper)
packages/
  db/       Oracle DB connection helpers
db/
  migrations/  Flyway SQL migrations (V<n>__<name>.sql)
docker/
  docker-compose.yml
  Caddyfile
```

## Prerequisites
- Node.js 20+
- pnpm 9+
- Docker + Docker Compose
- Oracle Autonomous Database (Always Free) with the wallet zip extracted into `./wallet/`

## Getting Started

```bash
cp .env.example .env   # fill in values
pnpm install
pnpm db:migrate        # runs Flyway in Docker (run with DDL-capable creds)
pnpm dev:web           # in one terminal
pnpm dev:ws            # in another
```

`pnpm db:migrate` is run **locally**, not in CI — the production deploy
intentionally uses a runtime user without DDL privileges, so schema
changes are applied from a workstation with owner credentials before
the matching code merges. See `docs/deploy.md` §2.

## Bootstrapping an Admin

There is no in-app admin signup and no `admins` table (it was dropped in
V3 — auth went OAuth-only). Effective admin = email listed in the
`ADMIN_EMAILS` env var (comma-separated), checked at request time.

```env
# .env
ADMIN_EMAILS=you@example.com,teammate@example.com
```

## Deployment

See `docs/deploy.md`.
