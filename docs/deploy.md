# Deploying PiePad to OCI

One-VM deployment with Docker Compose, Caddy, sslip.io HTTPS.

## 0. Pick a host

| Where | Notes |
| :-- | :-- |
| **OCI A1.Flex (ARM, Always Free)** | Best fit. 4 OCPU / 24GB RAM. Capacity is intermittent — keep retrying or try a different region. |
| OCI E2.1.Micro (x86, Always Free) | 1 OCPU / 1GB. Tight. Run with `PISTON_URL=https://emkc.org/api/v2/piston` (skip self-host) and disable cleanup if memory is short. |
| OCI Free Trial credit | Pick anything; ~$30/month after the trial ends. |
| Hetzner / DigitalOcean / Vultr | Multi-arch images run anywhere; ~$5/month for a 2GB box. |

Multi-arch images (linux/amd64 + linux/arm64) ship from the same Dockerfiles, so the host architecture doesn't change the deploy.

## 1. First-time host bootstrap

SSH in once. Replace `ubuntu` with `opc` on Oracle Linux.

```bash
# Docker
sudo apt update
sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# log out + back in so the group takes effect

# Open the firewall (OCI firewall + iptables)
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save || true
# Also open 80/443 in OCI Console → Networking → Security List

# Code + wallet
sudo mkdir -p /opt/piepad && sudo chown $USER /opt/piepad
git clone https://github.com/<you>/PiePad.git /opt/piepad
cd /opt/piepad

# Wallet: scp the ADB wallet zip from your laptop, then:
unzip -o Wallet_*.zip -d wallet/
sed -i 's|?/network/admin|/wallet|' wallet/sqlnet.ora || true
# (the WALLET_LOCATION line should already be removed for local Thin mode;
#  if it's there for JDBC, both forms work)
```

## 2. `.env` on the host

Copy `.env.example` and fill it in:

```bash
cp .env.example .env
chmod 600 .env
```

Required keys:

```
PUBLIC_IP=132.226.10.20
PUBLIC_HOST=132-226-10-20.sslip.io        # or your real domain
ORACLE_USER=APP_PROD_SCHEMA
ORACLE_PASSWORD=...
ORACLE_TNS_NAME=pxgb0h9y4fcyvwzb_tp
ORACLE_WALLET_DIR=/wallet
ORACLE_WALLET_PASSWORD=...                # set when you downloaded the wallet
AUTH_SECRET=...                           # openssl rand -hex 32
AUTH_GOOGLE_ID=...                        # Google Cloud Console OAuth client
AUTH_GOOGLE_SECRET=...
ADMIN_EMAILS=you@example.com
NEXT_PUBLIC_WS_URL=wss://132-226-10-20.sslip.io/yjs
WS_INTERNAL_URL=http://ws:1234            # compose internal address
PISTON_URL=http://piston:2000/api/v2      # or https://emkc.org/api/v2/piston
```

Add the deploy host to **Google Cloud Console → OAuth Client → Authorized redirect URIs**:
`https://<PUBLIC_HOST>/api/auth/callback/google`

## 3. First migration + boot

```bash
cd /opt/piepad

# Run V1/V2/V3 once (idempotent: re-runs are safe)
docker compose --env-file .env -f docker/docker-compose.yml \
  --profile tools run --rm flyway migrate

# Production stack: caddy + web + ws + cleanup
docker compose --env-file .env -f docker/docker-compose.yml up -d --build

# Optional: self-hosted Piston (skip if PISTON_URL points at emkc.org)
docker compose --env-file .env -f docker/docker-compose.yml \
  --profile runtime up -d piston
./scripts/install-piston-langs.sh http://localhost:2000
```

Caddy will fetch a Let's Encrypt cert for `${PUBLIC_HOST}` automatically — first request can take ~10s.

Sanity:

```bash
curl -I https://$PUBLIC_HOST/
docker compose -f docker/docker-compose.yml logs caddy --tail 50
docker compose -f docker/docker-compose.yml logs web   --tail 50
```

## 4. GitHub Actions wiring (subsequent deploys)

In the repo settings → Secrets and variables → Actions, add:

| Secret | Value |
| :-- | :-- |
| `DEPLOY_HOST` | VM public IP (or sslip.io host) |
| `DEPLOY_USER` | `ubuntu` / `opc` / whatever you SSH as |
| `DEPLOY_SSH_KEY` | private key paired with the VM's `~/.ssh/authorized_keys` |
| `PUBLIC_HOST` | same value as `.env`'s `PUBLIC_HOST` (used by post-deploy curl) |

Now every push to `main` runs `.github/workflows/deploy.yml`:
- SSH in
- `git reset --hard origin/main`
- `docker compose up -d --build`
- Apply pending Flyway migrations
- Curl the homepage as a smoke check

`workflow_dispatch` is enabled too, so you can re-trigger from the Actions tab.

## 5. Day-2 ops

```bash
# logs (live)
docker compose -f docker/docker-compose.yml logs -f web ws cleanup
docker compose -f docker/docker-compose.yml logs -f caddy

# restart one service
docker compose -f docker/docker-compose.yml restart web

# rollback to a previous commit
cd /opt/piepad
git reset --hard <SHA>
docker compose --env-file .env -f docker/docker-compose.yml up -d --build

# manual cleanup pass (without waiting for the cron)
docker compose -f docker/docker-compose.yml exec cleanup \
  pnpm exec tsx src/run-once.ts

# disk: leveldb + caddy data + piston packages
docker volume ls | grep piepad
df -h /var/lib/docker
```

## Switching Piston: self-hosted ↔ public

Edit `.env`:

```
# Self-hosted (Compose service "piston" in runtime profile)
PISTON_URL=http://piston:2000/api/v2

# Public (no API key, 5 req / 5 sec / IP shared by your whole server)
PISTON_URL=https://emkc.org/api/v2/piston
```

Restart `web` for the change to take effect:

```bash
docker compose --env-file .env -f docker/docker-compose.yml up -d --force-recreate web
```

## Troubleshooting

| Symptom | First thing to check |
| :-- | :-- |
| Caddy doesn't issue cert | `docker logs caddy` — usually port 80 not reachable from internet (firewall) |
| `/api/auth/callback/google` 400 | Redirect URI not in Google Cloud Console allow list, or `AUTH_SECRET` differs from what signed the JWT |
| Run button hangs | `PISTON_URL` mistargeted — see the route's terminal log (`[/api/run] Piston returned non-2xx`) |
| Wallet errors | `wallet/cwallet.sso` missing inside the container — check the compose `volumes:` line |
| ws clients all read-only | `meta.deleted` got persisted somehow; clear LevelDB volume `ws_data` and restart |
