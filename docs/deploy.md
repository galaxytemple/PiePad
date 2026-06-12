# Deploying PiePad to OCI

> **⚠️ Architecture correction (2026-06-11).** This document predates the current
> setup and describes a two-host split (a separate "Piston host") that was
> **abandoned**: Piston's image is amd64-only so it cannot run on an ARM A1, and
> the split added needless complexity. **Production now runs everything on one
> x86 box** — `caddy + web + ws + cleanup + piston` — with Piston co-located via
> the compose `runtime` profile and reached at the internal `http://piston:2000`.
> Images are built in **GitHub Actions** and pushed to **GHCR** (`linux/amd64`);
> the box only `docker compose --profile runtime pull && up -d` (no on-box build).
> The authoritative source is `.github/workflows/deploy.yml` +
> `docker/docker-compose.yml`. Treat the two-host / "Piston host" / multi-arch
> instructions below as **superseded** — in particular the `PISTON_URL` secret is
> `http://piston:2000/api/v2`, not a host IP, and there is no separate Piston
> bootstrap or port-2000 cross-host firewall rule.

Production runs on **two OCI instances**:

- **App host** — caddy + web + ws + cleanup. The user-facing entry point.
- **Piston host** — a dedicated VM running just the Piston container,
  reachable from the app host over a private (or SL-restricted public)
  IP. Sandboxed code execution can spike memory hard, so we keep it off
  the app box.

Single-host deploys are still possible for dev / demo, but production
should split.

## 0. Pick hosts

| Where | Notes |
| :-- | :-- |
| **OCI A1.Flex (ARM, Always Free)** | Best fit for the app host. 4 OCPU / 24GB RAM total — plenty of room. Capacity is intermittent; keep retrying or try a different region. Always Free, no expiry. |
| OCI E2.1.Micro (x86, Always Free) | 1 OCPU / 1GB. Workable for either host *if* you add 2GB swap. The current production deploy runs two of these. **Free Tier trial expires after ~30 days**, then the instance is reclaimed unless you upgrade. |
| Hetzner / DigitalOcean / Vultr | Multi-arch images run anywhere; ~$5/month for a 2GB box, no eviction risk. |

Multi-arch images (linux/amd64 + linux/arm64) ship from the same
Dockerfiles, so the host architecture doesn't change the deploy.

## 1. First-time host bootstrap (both hosts)

SSH in once. Replace `ubuntu` with `opc` on Oracle Linux.

```bash
# Docker
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# log out + back in so the group takes effect

# 2GB swap (E2.1.Micro 1GB hosts cannot run the stack reliably without it)
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-piepad.conf
sudo sysctl --system
free -h    # confirm Swap: 2.0Gi
```

### App host only

```bash
# Open 80/443 (HTTPS+HTTP/3 UDP)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save || true
# Also open 80/443 in OCI Console → Networking → Security List

# Code + wallet land
sudo mkdir -p /opt/piepad && sudo chown $USER /opt/piepad

# Wallet: scp the ADB wallet zip from your laptop, then:
cd /opt/piepad
unzip -o Wallet_*.zip -d wallet/
sed -i 's|?/network/admin|/wallet|' wallet/sqlnet.ora || true
```

The CI deploy step rsync's the source onto `/opt/piepad/`, so we don't
need a `git clone` here. The wallet is the only piece that lives only
on the VM.

### Piston host only

```bash
# Open 2000 *only to the app host*. Never to 0.0.0.0/0.
APP_HOST_IP=<app host private or public IP>
sudo iptables -I INPUT 6 -m state --state NEW -p tcp -s "$APP_HOST_IP" --dport 2000 -j ACCEPT
sudo netfilter-persistent save || true
# Also restrict 2000 in OCI Security List on this subnet to the same
# source. SL takes precedence over iptables; both must agree.
```

## 2. DB setup (one-time, from your laptop)

PiePad's production Oracle deploy uses a **split user pattern**:

- `APP_PROD_SCHEMA` — owns all tables. Has DDL. Used only for migrations.
- `APP_PROD_USER` — runtime login. No DDL. Reads/writes via grants on
  `APP_PROD_SCHEMA`'s objects through a role.
- `APP_PROD_DML_ROLE` — schema-level DML grants (Oracle 23ai), so future
  migrations don't need follow-up grants.

**Why:** least privilege at runtime. A leaked `.env` can't drop tables.

As ADMIN (in OCI Database Actions / SQL Developer), one-time setup:

```sql
-- Owner schema (DDL-capable, used only for flyway migrate)
CREATE USER APP_PROD_SCHEMA IDENTIFIED BY "<owner-pw>" DEFAULT TABLESPACE DATA;
GRANT CONNECT, RESOURCE TO APP_PROD_SCHEMA;
ALTER USER APP_PROD_SCHEMA QUOTA UNLIMITED ON DATA;

-- Runtime login user (no DDL)
CREATE USER APP_PROD_USER IDENTIFIED BY "<runtime-pw>";
GRANT CONNECT TO APP_PROD_USER;

-- DML role: schema-level so new tables are auto-covered
CREATE ROLE APP_PROD_DML_ROLE;
GRANT SELECT ANY TABLE ON SCHEMA APP_PROD_SCHEMA TO APP_PROD_DML_ROLE;
GRANT INSERT ANY TABLE ON SCHEMA APP_PROD_SCHEMA TO APP_PROD_DML_ROLE;
GRANT UPDATE ANY TABLE ON SCHEMA APP_PROD_SCHEMA TO APP_PROD_DML_ROLE;
GRANT DELETE ANY TABLE ON SCHEMA APP_PROD_SCHEMA TO APP_PROD_DML_ROLE;
GRANT APP_PROD_DML_ROLE TO APP_PROD_USER;
```

Then run migrations from your laptop using the **owner** credentials
(not the runtime ones):

```bash
# .env on your laptop, pointed at the owner user temporarily
ORACLE_USER=APP_PROD_SCHEMA
ORACLE_PASSWORD=<owner-pw>
ORACLE_TNS_NAME=...
ORACLE_WALLET_PASSWORD=...

./scripts/dc --profile tools run --rm flyway migrate
```

CI never runs `flyway migrate` — the runtime user can't do DDL anyway,
and shipping DDL credentials to CI would defeat the split. New
migrations get applied locally before the matching code merges.

## 3. GitHub Actions secrets

Repo Settings → Secrets and variables → Actions:

| Secret | Value |
| :-- | :-- |
| `DEPLOY_HOST` | App host public IP (or sslip.io host) |
| `DEPLOY_USER` | SSH user on the app host (`ubuntu` / `opc`) |
| `DEPLOY_SSH_KEY` | private key paired with the app host's `~/.ssh/authorized_keys` |
| `PUBLIC_IP` | Same as `DEPLOY_HOST` for sslip.io use; the value goes into `.env` |
| `PUBLIC_HOST` | e.g. `170-9-25-195.sslip.io` |
| `ORACLE_USER` | `APP_PROD_USER` (runtime login, NOT the owner) |
| `ORACLE_PASSWORD` | runtime user password |
| `ORACLE_TNS_NAME` | TNS alias from the wallet, e.g. `pxgb0h9y4fcyvwzb_tp` |
| `ORACLE_SCHEMA` | `APP_PROD_SCHEMA` (table owner — `withConnection` runs `ALTER SESSION SET CURRENT_SCHEMA` so unqualified names resolve here) |
| `ORACLE_WALLET_PASSWORD` | wallet password set when you downloaded it |
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `AUTH_GOOGLE_ID` | Google Cloud Console OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google Cloud Console OAuth client secret |
| `ADMIN_EMAILS` | comma-separated emails granted admin in-app |
| `PISTON_URL` | `http://<piston-host-IP>:2000/api/v2` |

The deploy workflow itself bakes additional fixed values into the `.env`
it writes on the app host: `AUTH_TRUST_HOST=true`,
`AUTH_URL=https://${PUBLIC_HOST}`, `WS_INTERNAL_URL=http://ws:1234`,
`NEXT_PUBLIC_WS_URL=wss://${PUBLIC_HOST}/yjs`. These are required for
Auth.js v5 behind a reverse proxy and don't need their own secrets.

Add the deploy host to **Google Cloud Console → OAuth Client →
Authorized redirect URIs**:
`https://<PUBLIC_HOST>/api/auth/callback/google`

## 4. Piston host (one-time)

The app stack's compose file has a `piston` service under the `runtime`
profile, but that's the **dev** path (running everything on one box).
For prod we run a single standalone container on the dedicated host:

```bash
# On the Piston host
docker run -d \
  --name piepad-piston \
  --restart unless-stopped \
  --privileged \
  --userns=host \
  --security-opt seccomp=unconfined \
  --security-opt apparmor=unconfined \
  -p 2000:2000 \
  -e PISTON_LOG_LEVEL=INFO \
  -e PISTON_BIND_ADDRESS=0.0.0.0:2000 \
  -e PISTON_DISABLE_NETWORKING=true \
  -e PISTON_RUN_TIMEOUT=30000 \
  -e PISTON_COMPILE_TIMEOUT=30000 \
  -e PISTON_OUTPUT_MAX_SIZE=1048576 \
  -m 600m \
  --memory-swap 1200m \
  --tmpfs /piston/jobs:exec,uid=1000,gid=1000,mode=711 \
  -v piston_packages:/piston/packages \
  ghcr.io/engineer-man/piston:latest

# Wait a few seconds for the API to come up, then install only the
# languages you actually serve (lean image, lean RAM):
sleep 5
curl -fsS -X POST http://127.0.0.1:2000/api/v2/packages \
  -H 'content-type: application/json' \
  -d '{"language":"python","version":"3.10.0"}'

curl -fsS -X POST http://127.0.0.1:2000/api/v2/packages \
  -H 'content-type: application/json' \
  -d '{"language":"typescript","version":"5.0.3"}'

# Smoke check
curl -fsS -X POST http://127.0.0.1:2000/api/v2/execute \
  -H 'content-type: application/json' \
  -d '{"language":"python","version":"*","files":[{"content":"print(2+2)"}]}'
# Expect: {"run":{"stdout":"4\n",...}}
```

The TypeScript runtime accepts plain JavaScript code too (TS is a
superset), so we don't ship a separate JS package — saves disk + RAM.
The app's language registry (`apps/web/src/lib/languages.ts`) reflects
this: only `typescript` is listed for runnable JS-family code.

> **Public Piston API note.** `https://emkc.org/api/v2/piston` became
> whitelist-only on **2026-02-15** — it returns HTTP 401 for anonymous
> traffic. Self-hosting is the only viable path now. The defensive
> parsing in `apps/web/src/app/api/run/route.ts` (3000ms clamp,
> tolerance for `{message}` responses) was kept around the cutover and
> remains as a safety net.

## 5. First app deploy

Push to `main`. The workflow:

1. SSH'es in to the app host.
2. Builds the `.env` from secrets (with the fixed values mentioned above).
3. rsync's the source to `/opt/piepad/`.
4. Runs `./scripts/dc up -d --build --remove-orphans` — caddy + web +
   ws + cleanup. **Does not run `flyway migrate`** (DB is owner-managed
   from your laptop, see §2).
5. Curls `https://${PUBLIC_HOST}/` as a smoke check.

Caddy fetches a Let's Encrypt cert for `${PUBLIC_HOST}` automatically —
the first request can take ~10s. After that:

```bash
curl -I https://$PUBLIC_HOST/                   # 302 → /login
curl -I https://$PUBLIC_HOST/login              # 200 (Next.js renders)
```

If `/login` 302's back to `/`, the most likely cause is missing
`AUTH_TRUST_HOST` / `AUTH_URL` (`tasks/lessons.md` has the symptom +
fix). The deploy.yml's `Build .env` step now sets both unconditionally.

## 6. Day-2 ops

```bash
# logs (live) — through ./scripts/dc which preloads the right --env-file/-f
./scripts/dc logs -f web ws cleanup
./scripts/dc logs -f caddy
./scripts/dc logs --tail 100 web | grep -iE '(error|ORA-|NJS-|auth)'

# Piston host: a single container, plain docker
docker logs -f piepad-piston

# Restart one service
./scripts/dc restart web

# Rollback by re-running deploy with a previous commit
gh workflow run deploy.yml --ref <SHA>

# Manual cleanup pass (without waiting for the cron)
./scripts/dc exec cleanup pnpm exec tsx src/run-once.ts

# Disk: leveldb + caddy data + piston packages
docker volume ls | grep -E '(piepad|caddy)'
df -h /var/lib/docker
```

## Migrating to a new VM IP (sslip.io rebuild)

When the app host's IP changes (rebuild, new region, free-tier expiry):

1. Update GH secrets:
   ```bash
   gh secret set DEPLOY_HOST  -b "<new-ip>"
   gh secret set PUBLIC_IP    -b "<new-ip>"
   gh secret set PUBLIC_HOST  -b "<new-ip-with-dashes>.sslip.io"
   ```
2. Add the new redirect URI in Google Cloud Console → OAuth Client →
   Authorized redirect URIs:
   `https://<new-public-host>/api/auth/callback/google`
   (you can keep the old one until the old VM is shut down).
3. If the Piston host's IP also changes, update `PISTON_URL` and the
   Piston-host SL rule that whitelists the app host.
4. `gh workflow run deploy.yml`
5. Verify `curl -I https://<new-host>/login` returns 200, then remove
   the old redirect URI from Google.

## Troubleshooting

| Symptom | First thing to check |
| :-- | :-- |
| Caddy doesn't issue cert | `./scripts/dc logs caddy` — usually port 80 unreachable from the internet (firewall / SL) |
| `ERR_TOO_MANY_REDIRECTS` on every page | `AUTH_TRUST_HOST` / `AUTH_URL` missing. `./scripts/dc logs web` will show `[auth][error] UntrustedHost`. |
| `/api/auth/callback/google` 400 / `error=Configuration` | Redirect URI not in Google Cloud Console allow list, or `AUTH_SECRET` differs from what signed the JWT |
| `error=AccessDenied` after Google sign-in | `signIn` callback returned false — usually `upsertOAuthUser` threw. Grep web logs for `ORA-` to see the underlying DB error |
| `ORA-00942: ... does not exist` | `ORACLE_SCHEMA` not set or wrong — `withConnection` couldn't `ALTER SESSION SET CURRENT_SCHEMA` to the owner |
| `ORA-41900: missing <SELECT/INSERT> privilege` | `APP_PROD_DML_ROLE` missing the corresponding `<priv> ANY TABLE ON SCHEMA` grant. Note `READ` ≠ `SELECT`. |
| `NJS-040: connection request timeout` | Pool exhausted or `sessionCallback` hanging. PiePad runs the schema setup inline (see lessons), not via `sessionCallback`. |
| Run button → `piston_unreachable` | Piston host down, or app host's `PISTON_URL` points at the wrong IP / doesn't include `/api/v2` |
| Run output cut off / `stdout length exceeded` | `PISTON_OUTPUT_MAX_SIZE` not set (default 1 KB). Set `-e PISTON_OUTPUT_MAX_SIZE=1048576` on the Piston container. (Co-located prod sets it in `docker/docker-compose.yml`.) |
| Run button → `piston_rejected` (502) | Piston returned `{message}` at 200 — language not installed on the Piston host, or request hit a cap. `docker logs -f piepad-piston` for the real error. |
| ws clients all read-only | `meta.deleted` got persisted somehow; clear LevelDB volume `ws_data` and restart |
| Wallet errors | `wallet/cwallet.sso` missing inside the container — check the compose `volumes:` line and that you scp'd the wallet to `/opt/piepad/wallet/` |
