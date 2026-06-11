# Deploy Split — Web on small instance, Piston on A1

**Goal:** Keep `caddy + web + ws + cleanup` on the existing small instance; move
the Piston code-runtime to the new A1 instance. Reach Piston over the **private
VCN** (never the public internet).

**Topology:** both instances are in the **same VCN, public subnets** → web can
reach A1 over its private IP (`10.x.x.x`).

---

## 0. The real deploy blocker (must fix — the split alone does NOT)

The failing deploy log:

```
RUN pnpm --filter @piepad/web build
470.5 ✓ Compiled successfully in 7.7min
473.2   Running TypeScript ...
client_loop: send disconnect: Broken pipe
```

`docker compose up --build` builds the Next.js image **on the small box**. The
build takes ~8 min of pegged CPU, and the deploy SSH session dies
(`Broken pipe`) before `up` finishes. Moving Piston to A1 frees runtime memory
but the **web image is still built on the small box**, so this break persists.

**Fix: build images in GitHub Actions, push to GHCR, and have the VM only
`docker compose pull && up -d` — zero compilation on the box.** This also makes
deploys ~10× faster and removes the OOM/timeout risk entirely.

(Quick stopgap if you want the smallest possible change first: in the deploy
SSH step add `-o ServerAliveInterval=30 -o ServerAliveCountMax=10` and run the
build under `nohup ... &` + poll. This keeps the pipe alive but the box still
struggles. The registry approach below is the durable fix.)

---

## Architecture after the change

```
        GitHub Actions (amd64 runner)
        ├─ build & push  ghcr.io/<owner>/piepad-web,  -ws,  -cleanup
        ├─ ssh small box:  docker compose pull && up -d        (web/ws/cleanup/caddy)
        └─ ssh A1:         docker compose -f piston-compose.yml up -d + install langs

  small instance (public subnet)              A1 instance (public subnet)
  ┌───────────────────────────┐  private IP   ┌──────────────────────────┐
  │ caddy → web → /api/run ────┼──────────────►│ piston :2000 (private IP)│
  │        ws, cleanup         │  10.x.x.x:2000│  firewalled to web IP    │
  └───────────────────────────┘               └──────────────────────────┘
            PISTON_URL = http://<A1_PRIVATE_IP>:2000/api/v2
```

`/api/run` already calls `fetch(PISTON_URL + "/execute")` server-side, so only
the `PISTON_URL` env var changes — **no app code edits**. The default compose
profile already excludes `piston`, so the small box stops running it the moment
`PISTON_URL` points at A1.

---

## ⚠️ Architecture (CPU) checks before you start

1. **Confirm the web box arch:** `ssh <web> uname -m`.
   - `x86_64` → E2.1.Micro (AMD). CI must build `--platform linux/amd64`.
   - `aarch64` → A1 (ARM). CI must build `--platform linux/arm64`.
   GitHub-hosted runners are amd64; for arm64 images either use
   `docker/setup-qemu-action` (emulated build, slower) or a native arm64 runner.
2. **Piston on A1 is ARM64 (`aarch64`).** Verify `ghcr.io/engineer-man/piston:latest`
   runs on arm64 and that the language packages you need (python/node/typescript/
   java/c++) have arm64 builds in Piston's package index. Test with
   `scripts/install-piston-langs.sh` against the A1 instance and confirm each
   line says `installed` (not `FAILED`). If a runtime has no arm64 package, that
   language won't run — flag it before relying on it.

---

## Part A — Build in CI + pull on VM (fixes the broken pipe)

### A1. Compose: switch web/ws/cleanup from `build:` to `image:`

In `docker/docker-compose.yml`, replace each `build:` block with an `image:`
referencing GHCR, tag driven by an env var (`IMAGE_TAG`, default `latest`):

```yaml
  web:
    image: ghcr.io/<owner>/piepad-web:${IMAGE_TAG:-latest}
    # (drop the build: block; keep env_file, environment, volumes, healthcheck,
    #  depends_on, mem_limit exactly as-is)
  ws:
    image: ghcr.io/<owner>/piepad-ws:${IMAGE_TAG:-latest}
  cleanup:
    image: ghcr.io/<owner>/piepad-cleanup:${IMAGE_TAG:-latest}
```

`NEXT_PUBLIC_WS_URL` is baked at **build** time → it must be passed as a
build-arg in CI (it no longer has a compose build stage). It is derivable from
the `PUBLIC_HOST` secret: `wss://<PUBLIC_HOST>/yjs`.

### A2. deploy.yml: add a build-and-push job

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write          # push to GHCR
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      # If web box is arm64, also: - uses: docker/setup-qemu-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build & push web
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./docker/web.Dockerfile
          platforms: linux/amd64          # or linux/arm64 — match the web box
          build-args: |
            NEXT_PUBLIC_WS_URL=wss://${{ secrets.PUBLIC_HOST }}/yjs
          tags: |
            ghcr.io/<owner>/piepad-web:${{ github.sha }}
            ghcr.io/<owner>/piepad-web:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
      # Repeat two more steps for ws (./docker/ws.Dockerfile) and
      # cleanup (./docker/cleanup.Dockerfile), no build-args needed.
```

### A3. deploy.yml: the VM step pulls instead of builds

The VM must authenticate to GHCR to pull. Two options:
- **Make the three packages public** (GHCR → package → visibility → public).
  Then no login needed on the VM. Simplest; images contain no secrets.
- Or `docker login ghcr.io` on the VM in the deploy step using a read-only PAT
  stored as a secret.

The build/restart SSH step becomes (note: still rsync the compose file,
Caddyfile, scripts, wallet stays on box — but **no source build**):

```bash
ssh ... "set -euo pipefail
  cd /opt/piepad
  export IMAGE_TAG=${{ github.sha }}
  ./scripts/dc pull
  ./scripts/dc up -d --remove-orphans
  ./scripts/dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile \
    || ./scripts/dc restart caddy
  docker image prune -f
"
```

`scripts/dc` already passes `--env-file .env`; add `IMAGE_TAG` to the generated
`.env` (or `export` it in the SSH command as above). The `build` job must be a
dependency: `deploy-web: { needs: build }`.

---

## Part B — Piston on the A1 instance

### B1. Bootstrap A1 (Ubuntu 24.04 assumed; ARM64)

Follow `script/oci-vm-bootstrap.md` §3 (Docker install, deploy dir
`/opt/piepad-piston`). For the host firewall, instead of 80/443 open the Piston
port **only to the web instance's private IP**:

```bash
# Replace <WEB_PRIVATE_IP> with the small box's private IP (ip -4 addr on web).
sudo iptables -I INPUT 6 -m state --state NEW -p tcp \
  -s <WEB_PRIVATE_IP>/32 --dport 2000 -j ACCEPT
sudo netfilter-persistent save
```

Do **not** open 2000 to `0.0.0.0/0`.

### B2. Piston-only compose on A1

Create `docker/piston-compose.yml` (a trimmed copy of the existing `piston`
service — same privileged/nsjail/tmpfs settings — but published on the **private
IP** so only in-VCN hosts can reach it):

```yaml
services:
  piston:
    image: ghcr.io/engineer-man/piston:latest
    container_name: piepad-piston
    restart: unless-stopped
    privileged: true
    userns_mode: host
    security_opt: [seccomp=unconfined, apparmor=unconfined]
    ports:
      - "<A1_PRIVATE_IP>:2000:2000"   # bind to the private NIC only
    environment:
      PISTON_LOG_LEVEL: INFO
      PISTON_BIND_ADDRESS: 0.0.0.0:2000
      PISTON_DISABLE_NETWORKING: "true"
      PISTON_RUN_TIMEOUT: "30000"
      PISTON_COMPILE_TIMEOUT: "30000"
    volumes:
      - piston_packages:/piston/packages
    tmpfs:
      - /piston/jobs:exec,uid=1000,gid=1000,mode=711
    mem_limit: 2g            # A1 has headroom; raise from 384m
volumes:
  piston_packages:
```

Bring up + install runtimes:

```bash
cd /opt/piepad-piston
docker compose -f docker/piston-compose.yml up -d
bash scripts/install-piston-langs.sh http://<A1_PRIVATE_IP>:2000
```

### B3. OCI Security List / NSG (console)

In the VCN's security list (or an NSG attached to A1's VNIC), add an **ingress**
rule:

| Source | Protocol | Dest port | Note |
|---|---|---|---|
| `<WEB_PRIVATE_IP>/32` | TCP | `2000` | web → piston only |

Both host iptables **and** the OCI security list must allow it (two independent
layers on OCI). Leave 2000 closed to everything else.

### B4. Point web at A1

Update the `PISTON_URL` GitHub secret:

```
PISTON_URL = http://<A1_PRIVATE_IP>:2000/api/v2
```

deploy.yml already writes `PISTON_URL=${{ secrets.PISTON_URL }}` into `.env`, so
the next web deploy picks it up. `RUN_TIMEOUT_MS`/`COMPILE_TIMEOUT_MS` (10000)
stay well under Piston's 30000 ceiling — no change needed.

---

## Part C — CI/CD: final deploy.yml shape

```
on: push [main] / workflow_dispatch
jobs:
  build:         build & push web/ws/cleanup → GHCR            (amd64 or arm64)
  deploy-web:    needs: build
                 ssh small box → rsync compose/Caddyfile/scripts + .env
                                → docker compose pull && up -d
  deploy-piston: ssh A1 → docker compose -f piston-compose.yml up -d
                        → install-piston-langs.sh (idempotent)
```

- `deploy-web` and `deploy-piston` can run in parallel (independent hosts).
- Keep `concurrency: deploy-prod, cancel-in-progress: false`.
- Piston rarely changes; you can gate `deploy-piston` behind a path filter
  (`docker/piston-compose.yml`, `scripts/install-piston-langs.sh`) or
  `workflow_dispatch` so normal app deploys don't touch A1.

---

## Part D — Secrets checklist (GitHub → Settings → Secrets → Actions)

Existing (keep): `DEPLOY_SSH_KEY`, `DEPLOY_HOST` (small box public IP),
`DEPLOY_USER`, `PUBLIC_HOST`, `PUBLIC_IP`, Oracle/Auth/Admin secrets.

Add / change:

| Secret | Value |
|---|---|
| `PISTON_URL` | `http://<A1_PRIVATE_IP>:2000/api/v2` (changed) |
| `PISTON_DEPLOY_HOST` | A1 **public** IP (for SSH from CI) |
| `PISTON_DEPLOY_USER` | `ubuntu` / `opc` |
| `PISTON_SSH_KEY` | A1 deploy private key (or reuse `DEPLOY_SSH_KEY` if you add the same pubkey to A1) |
| (optional) `GHCR_PAT` | read-only PAT for `docker login ghcr.io` on the VMs, if packages stay private |

`A1_PRIVATE_IP` and `WEB_PRIVATE_IP` are used in the one-time A1 setup
(iptables, compose bind, PISTON_URL) — they don't need to be CI secrets unless
you template the piston-compose port in CI.

---

## Verification

1. CI: `build` job pushes 3 images to GHCR (check the repo's Packages tab).
2. A1: `docker compose -f docker/piston-compose.yml ps` → piston `Up`;
   `curl -fsS http://<A1_PRIVATE_IP>:2000/api/v2/runtimes` from the **web box**
   lists the installed languages; the same curl from your laptop **times out**
   (proves it's not internet-exposed).
3. Web deploy: site loads, and Run ▶ on a Python pad returns output (web →
   A1 path works).
4. `docker stats` on the small box: no piston container; memory comfortably
   under the 1 GB limit during a deploy (no build happening on-box).
```
