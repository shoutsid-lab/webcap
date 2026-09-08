#!/usr/bin/env bash
# One-command Fly.io deployment for webcap.
#
# Prerequisites:
#   - flyctl CLI installed (https://fly.io/docs/hands-on/install-flyctl/)
#   - Logged in: fly auth login
#
# Usage:
#   ./deploy/deploy-fly.sh                  # deploy with defaults (base-sepolia testnet)
#   CHAIN=base ./deploy/deploy-fly.sh       # deploy on Base mainnet (real money)
#
# This script:
#   1. Launches the app on Fly.io (first time) or skips if already launched
#   2. Creates a persistent volume for the SQLite database
#   3. Sets all required secrets via deploy-fly-secrets.sh
#   4. Deploys the Docker image
#   5. Verifies the deployment with a health check
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="${FLY_APP_NAME:-webcap}"
REGION="${FLY_REGION:-lhr}"
CHAIN="${CHAIN:-base-sepolia}"
MERCHANT_KEY="${MERCHANT_KEY:-${USDC_MERCHANT_PRIVATE_KEY:-}}"
MERCHANT_ADDRESS="${MERCHANT_ADDRESS:-${WEBCAP_MERCHANT_ADDRESS:-}}"
EXTRACT_PRICE="${EXTRACT_PRICE:-0.01}"
AUDIT_PRICE="${AUDIT_PRICE:-0.002}"
VIDEO_PRICE="${VIDEO_PRICE:-0.005}"

# --- Preflight checks ---
command -v flyctl >/dev/null 2>&1 || command -v fly >/dev/null 2>&1 || {
  echo "ERROR: flyctl not found. Install: https://fly.io/docs/hands-on/install-flyctl/"
  exit 1
}
FLY="flyctl"
command -v fly >/dev/null 2>&1 && FLY="fly"

echo "==> checking Fly.io auth"
$FLY auth whoami >/dev/null 2>&1 || { echo "ERROR: not logged in. Run: fly auth login"; exit 1; }
echo "    logged in as: $($FLY auth whoami 2>/dev/null)"

# --- Preflight: secrets ---
if [ -z "$MERCHANT_KEY" ] && [ -z "$MERCHANT_ADDRESS" ]; then
  echo "WARNING: no MERCHANT_KEY or MERCHANT_ADDRESS set — deploy will fail without a payment recipient."
  echo "  Set MERCHANT_KEY=0x... (private key) or MERCHANT_ADDRESS=0x... (read-only address) and re-run."
fi

echo
echo "=== webcap Fly.io deployment ==="
echo "  app:     $APP_NAME"
echo "  region:  $REGION"
echo "  chain:   $CHAIN"
echo

# --- Step 1: Launch or verify app exists ---
echo "==> [1/5] checking if app '$APP_NAME' exists"
if $FLY status --app "$APP_NAME" >/dev/null 2>&1; then
  echo "    app '$APP_NAME' already exists"
else
  echo "    creating app '$APP_NAME'"
  ( cd "$REPO_DIR" && $FLY launch --app "$APP_NAME" --region "$REGION" --no-deploy --copy-config )
fi

# --- Step 2: Create persistent volume (idempotent) ---
echo "==> [2/5] ensuring persistent volume for SQLite DB"
if ! $FLY volume list --app "$APP_NAME" 2>/dev/null | grep -q "data"; then
  echo "    creating 1GB volume 'data' in $REGION"
  $FLY volume create data --app "$APP_NAME" --region "$REGION" --size 1
else
  echo "    volume 'data' already exists"
fi

# --- Step 3: Set secrets ---
echo "==> [3/5] setting secrets"
"$SCRIPT_DIR/deploy-fly-secrets.sh" "$APP_NAME"

# --- Step 4: Deploy ---
echo "==> [4/5] deploying"
( cd "$REPO_DIR" && $FLY deploy --app "$APP_NAME" --remote-only )

# --- Step 5: Health check ---
echo "==> [5/5] verifying deployment"
APP_URL="https://${APP_NAME}.fly.dev"
echo "    waiting for deployment to stabilize..."
sleep 10
HEALTH=$(curl -fsS --max-time 15 "${APP_URL}/v1/health" 2>/dev/null || echo '{"ok":false}')
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo
  echo "=== DEPLOYMENT SUCCESSFUL ==="
  echo "  Live URL:  $APP_URL"
  echo "  Health:    $HEALTH"
  echo
  echo "  Next steps:"
  echo "    1. Update WEBCAP_PUBLIC_BASE_URL=$APP_URL in your config"
  echo "    2. Test the capture endpoint: curl -X POST $APP_URL/v1/x402/capture -H 'Content-Type: application/json' -d '{\"url\":\"https://example.com\"}'"
  echo "    3. List on x402 Bazaar (optional): add CDP_API_KEY_ID + CDP_API_KEY_SECRET to secrets"
else
  echo
  echo "WARNING: health check did not return ok=true"
  echo "  URL: $APP_URL/v1/health"
  echo "  Response: $HEALTH"
  echo "  Check logs: $FLY logs --app $APP_NAME"
fi
