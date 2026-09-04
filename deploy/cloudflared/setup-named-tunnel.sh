#!/usr/bin/env bash
# Set up a Cloudflare NAMED tunnel for webcap -> a STABLE https://webcap.<zone>.com (no VPS needed).
#
# Requires: the `cloudflared` CLI + a Cloudflare API token with `zone:read` + `tunnel:write` scopes.
# Usage:  CF_TOKEN=... CF_ZONE=example.com ./setup-named-tunnel.sh
#
# Re-running re-uses the existing tunnel (idempotent-ish).
set -euo pipefail

CF_TOKEN="${CF_TOKEN:?set CF_TOKEN (a Cloudflare API token with zone:read + tunnel:write)}"
CF_ZONE="${CF_ZONE:?set CF_ZONE (your Cloudflare zone, e.g. example.com)}"
HOSTNAME="webcap.${CF_ZONE}"
TUNNEL_NAME="webcap"
CONFIG_DIR="/etc/cloudflared"
CONFIG_YML="${CONFIG_DIR}/webcap.yml"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v cloudflared >/dev/null || { echo "cloudflared CLI not found — install it first."; exit 1; }
mkdir -p "$CONFIG_DIR"

echo "==> ensuring tunnel '${TUNNEL_NAME}' exists"
TUNNEL_ID="$(cloudflared tunnel list --token "$CF_TOKEN" | awk -v n="$TUNNEL_NAME" '$2==n {print $1; exit}')"
if [ -z "${TUNNEL_ID}" ]; then
  echo "==> creating tunnel '${TUNNEL_NAME}'"
  cloudflared tunnel create "$TUNNEL_NAME" --token "$CF_TOKEN"
  TUNNEL_ID="$(cloudflared tunnel list --token "$CF_TOKEN" | awk -v n="$TUNNEL_NAME" '$2==n {print $1; exit}')"
fi
[ -n "${TUNNEL_ID}" ] || { echo "could not resolve tunnel id"; exit 1; }
echo "==> tunnel id: ${TUNNEL_ID}"

echo "==> writing config to ${CONFIG_YML}"
sed -e "s/__TUNNEL_ID__/${TUNNEL_ID}/g" -e "s/__ZONE__/${CF_ZONE}/g" \
  "${SCRIPT_DIR}/config-template.yml" > "$CONFIG_YML"
cloudflared tunnel credentials write --tunnel "$TUNNEL_ID" --token "$CF_TOKEN" --out "${CONFIG_DIR}/webcap.json"
chmod 600 "${CONFIG_DIR}/webcap.json"

echo "==> routing DNS ${HOSTNAME}"
cloudflared tunnel route dns "$TUNNEL_ID" "$HOSTNAME" --token "$CF_TOKEN"

echo "==> installing + starting the systemd unit (24/7)"
cp "${SCRIPT_DIR}/cloudflared.service" /etc/systemd/system/cloudflared-webcap.service
systemctl daemon-reload
systemctl enable --now cloudflared-webcap.service

echo
echo "SUCCESS — stable public URL:  https://${HOSTNAME}"
echo "The tunnel runs under systemd (cloudflared-webcap.service, Restart=always)."
