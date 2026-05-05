# PiePad

Real-time collaborative notepad with code execution, deployed on Oracle Cloud Infrastructure (OCI) Free Tier.

## Stack
- Next.js 16 (App Router) + Monaco Editor
- Yjs + y-websocket (CRDT real-time sync)
- Self-hosted Piston for code execution
- Oracle Autonomous Database (mTLS) for metadata + Yjs snapshot persistence
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
pnpm db:migrate        # runs Flyway in Docker
pnpm dev:web           # in one terminal
pnpm dev:ws            # in another
```

## Bootstrapping an Admin

There is no in-app admin signup. Insert a row directly:

```bash
# 1. Generate a bcrypt hash locally
node -e "console.log(require('bcrypt').hashSync('your-strong-password', 12))"
```

```sql
-- 2. Connect to Oracle and run:
INSERT INTO admins (username, password_hash)
VALUES ('admin', '$2b$12$...');
COMMIT;
```

## Deployment

See `docs/deploy.md` (TBD).
