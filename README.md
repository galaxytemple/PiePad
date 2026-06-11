# PiePad

Real-time collaborative notepad with code execution, deployed on Oracle Cloud Infrastructure (OCI) Free Tier.

## Stack
- Next.js 16 (App Router) + Monaco Editor
- Yjs + y-websocket (CRDT real-time sync)
- Auth.js v5 + Google OAuth
- Piston for code execution (self-hosted, **co-located on the app box** via the
  compose `runtime` profile and reached at the internal `http://piston:2000`;
  the public emkc.org endpoint became whitelist-only on 2026-02-15 and is no
  longer used). Images are built in CI and pushed to GHCR; the box only pulls.
- Cytoscape + react-resizable-panels for the in-editor graph/tree view
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

## Graph View (Python)

When the editor language is Python, a collapsible panel renders data structures
from directives printed to the run's stdout (these lines are stripped from the
output panel):

- `graph[@id]: [[1,2],[],[]]` — adjacency list; `:directed` (default) or `:undirected`.
- `tree[@id]: [1,2,3,null,null,4,5]` — binary tree, LeetCode level-order (`null`/`None`).
- `graph_node[@id]:<n>:color:<1-16>:info:<text>` — colour and/or label a node (attrs combine in one step).
- `graph_edge[@id]:<src>:<dst>:color:<1-16>:label:<text>` — colour and/or label an edge.

A step timeline (◀ ▶ / slider / ← →) replays the directives; `@id` shows several
graphs at once. Built with Cytoscape + react-resizable-panels in
`apps/web/src/components/pad/` over the pure parser
`apps/web/src/lib/graph-directives.ts`.

## Deployment

See `docs/deploy.md`.
