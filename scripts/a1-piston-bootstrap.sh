#!/usr/bin/env bash
#
# One-time bootstrap for the A1 (ARM64) instance that hosts ONLY the Piston
# code-runtime. Run this once, on the A1 box, as the deploy user (sudo-capable).
#
# It installs Docker, opens TCP 2000 to the web instance's private IP ONLY,
# brings up Piston bound to the A1 private NIC, and installs language runtimes.
#
# Required env (export before running, or edit the defaults below):
#   WEB_PRIVATE_IP   private IP of the small web instance (the only allowed client)
#   A1_PRIVATE_IP    this A1 box's own private IP (Piston binds here)
#
# The repo is PRIVATE, so this script does not curl files from GitHub. Copy the
# two files it needs onto the A1 box first (run step 1 here, or mkdir, then):
#   scp -i <key> docker/piston-compose.yml       <user>@<a1>:/opt/piepad-piston/docker/
#   scp -i <key> scripts/install-piston-langs.sh <user>@<a1>:/opt/piepad-piston/scripts/
#
# Example:
#   WEB_PRIVATE_IP=10.0.0.10 A1_PRIVATE_IP=10.0.0.20 \
#     bash scripts/a1-piston-bootstrap.sh
#
# Assumes Ubuntu 24.04 (apt + iptables/netfilter-persistent). For Oracle Linux,
# swap apt→dnf and iptables/netfilter-persistent→firewall-cmd.
#
# NOTE: This sets the OS firewall layer. You must ALSO add an OCI Security List
# (or NSG) ingress rule: source <WEB_PRIVATE_IP>/32, TCP, dest port 2000.
# Both layers are required on OCI.

set -euo pipefail

: "${WEB_PRIVATE_IP:?set WEB_PRIVATE_IP to the web instance private IP}"
: "${A1_PRIVATE_IP:?set A1_PRIVATE_IP to this box private IP}"

PROJECT_DIR="/opt/piepad-piston"

echo "==> arch check"
ARCH="$(uname -m)"
echo "    uname -m = ${ARCH}"
if [ "$ARCH" != "aarch64" ]; then
  echo "    WARNING: expected aarch64 (A1 is ARM). Continuing anyway."
fi

echo "==> 1. deploy dir"
sudo mkdir -p "${PROJECT_DIR}/docker" "${PROJECT_DIR}/scripts"
sudo chown -R "$USER:$USER" "${PROJECT_DIR}"
sudo chmod 750 "${PROJECT_DIR}"

echo "==> 2. Docker Engine + Compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt update
  sudo apt install -y ca-certificates curl gnupg netfilter-persistent
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER"
  echo "    Docker installed. You must re-login (exit + ssh back) for the"
  echo "    docker group to apply, then re-run this script — it will skip"
  echo "    install and continue."
  exit 0
fi

echo "==> 3. host firewall: allow TCP 2000 from web private IP ONLY"
# Insert above the default DROP. Idempotent-ish: only add if not already present.
if ! sudo iptables -C INPUT -m state --state NEW -p tcp \
      -s "${WEB_PRIVATE_IP}/32" --dport 2000 -j ACCEPT 2>/dev/null; then
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp \
    -s "${WEB_PRIVATE_IP}/32" --dport 2000 -j ACCEPT
fi
sudo netfilter-persistent save
echo "    (Reminder: also add the OCI Security List ingress rule for 2000.)"

echo "==> 4. check required files are present (scp them first — see header)"
for f in docker/piston-compose.yml scripts/install-piston-langs.sh; do
  if [ ! -f "${PROJECT_DIR}/${f}" ]; then
    echo "::error:: missing ${PROJECT_DIR}/${f} — scp it from the repo first (private repo; cannot fetch)."
    exit 1
  fi
done
chmod +x "${PROJECT_DIR}/scripts/install-piston-langs.sh"

printf 'PISTON_BIND_IP=%s\n' "${A1_PRIVATE_IP}" > "${PROJECT_DIR}/.env"
chmod 600 "${PROJECT_DIR}/.env"

echo "==> 5. start Piston"
cd "${PROJECT_DIR}"
docker compose --env-file .env -f docker/piston-compose.yml up -d

echo "==> 6. install language runtimes (verify each says 'installed')"
# ARM64 caveat: a language with no arm64 package in Piston's index will FAIL
# here and that language will not run. Check the output.
bash scripts/install-piston-langs.sh "http://${A1_PRIVATE_IP}:2000"

echo
echo "==> done. Verify from the WEB box:"
echo "    curl -fsS http://${A1_PRIVATE_IP}:2000/api/v2/runtimes | jq ."
echo "    (the same curl from anywhere else must time out)"
echo
echo "Then set the GitHub secret PISTON_URL = http://${A1_PRIVATE_IP}:2000/api/v2"
echo "and redeploy the web app."
