#!/usr/bin/env bash
# One-command 24/7 deploy of webcap to a fresh Ubuntu/Debian VPS (Docker + systemd, auto-restart).
# Idempotent: safe to re-run. Expects the repo already at $REPO_DIR (default /opt/webcap).
#
# Usage:
#   MERCHANT_KEY=0x... CHAIN=base-sepolia ./deploy/deploy-vps.sh
#   (set MERCHANT_KEY or MERCHANT_ADDRESS; CHAIN defaults to base-sepolia)
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/webcap}"
CHAIN="${CHAIN:-base-sepolia}"
FACILITATOR="${FACILITATOR:-https://x402.org/facilitator}"
PRICE="${PRICE:-0.001}"
MERCHANT_KEY="${MERCHANT_KEY:-${USDC_MERCHANT_PRIVATE_KEY:-}}"
MERCHANT_ADDRESS="${MERCHANT_ADDRESS:-${WEBCAP_MERCHANT_ADDRESS:-}}"

[ -d "$REPO_DIR" ] || { echo "repo not at $REPO_DIR — clone it there first (git clone <url> $REPO_DIR)"; exit 1; }
[ -n "$MERCHANT_KEY" ] || [ -n "$MERCHANT_ADDRESS" ] || { echo "set MERCHANT_KEY or MERCHANT_ADDRESS"; exit 1; }

echo "==> ensuring Docker + compose plugin"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || { echo "install the docker compose plugin"; exit 1; }

echo "==> building the image"
( cd "$REPO_DIR" && git pull --ff-only ) || true
( cd "$REPO_DIR" && docker compose build )

echo "==> writing $REPO_DIR/.env (from deploy/webcap.env.template)"
( cd "$REPO_DIR" && sed \
    -e "s/^WEBCAP_CHAIN=.*/WEBCAP_CHAIN=${CHAIN}/" \
    -e "s/^X402_FACILITATOR_URL=.*/X402_FACILITATOR_URL=${FACILITATOR}/" \
    -e "s/^WEBCAP_X402_PRICE_USDC=.*/WEBCAP_X402_PRICE_USDC=${PRICE}/" \
    -e "s/^USDC_MERCHANT_PRIVATE_KEY=.*/USDC_MERCHANT_PRIVATE_KEY=${MERCHANT_KEY}/" \
    -e "s/^# WEBCAP_MERCHANT_ADDRESS=.*/WEBCAP_MERCHANT_ADDRESS=${MERCHANT_ADDRESS}/" \
    deploy/webcap.env.template > .env )
chmod 600 "$REPO_DIR/.env"

echo "==> installing + starting the systemd unit (Restart=always)"
cp "$REPO_DIR/deploy/webcap.service" /etc/systemd/system/webcap.service
systemctl daemon-reload
systemctl enable --now webcap.service
sleep 5

echo "==> status"; systemctl --no-pager status webcap | head -n 12 || true
echo "==> local health"; curl -fsS http://localhost:8080/v1/health && echo
echo
echo "Deployed + auto-restarting. Now expose it publicly: a Cloudflare named tunnel"
echo "(deploy/cloudflared/setup-named-tunnel.sh) or a reverse proxy / firewall port-forward."
