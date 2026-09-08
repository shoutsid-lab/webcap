#!/usr/bin/env bash
# Set all required Fly.io secrets for webcap.
#
# Usage:
#   ./deploy/deploy-fly-secrets.sh [app-name]
#
# Reads from environment variables and/or prompts for values.
# Secrets are NEVER written to disk — they go directly to Fly's encrypted store.
set -euo pipefail

APP_NAME="${1:-${FLY_APP_NAME:-webcap}}"

# --- Chain configuration ---
CHAIN="${CHAIN:-base-sepolia}"
case "$CHAIN" in
  base)
    FACILITATOR="${FACILITATOR:-https://api.cdp.coinbase.com/platform/v2/x402}"
    ;;
  base-sepolia)
    FACILITATOR="${FACILITATOR:-https://x402.org/facilitator}"
    ;;
  *)
    echo "ERROR: unknown chain '$CHAIN' (expected: base, base-sepolia)"
    exit 1
    ;;
esac

# --- Merchant key (required for real money) ---
MERCHANT_KEY="${MERCHANT_KEY:-${USDC_MERCHANT_PRIVATE_KEY:-}}"
MERCHANT_ADDRESS="${MERCHANT_ADDRESS:-${WEBCAP_MERCHANT_ADDRESS:-}}"

if [ -z "$MERCHANT_KEY" ] && [ -z "$MERCHANT_ADDRESS" ]; then
  echo "ERROR: set MERCHANT_KEY (private key) or MERCHANT_ADDRESS (read-only) before running."
  echo "  export MERCHANT_KEY=0x..."
  exit 1
fi

# --- Pricing ---
X402_PRICE="${X402_PRICE:-${WEBCAP_X402_PRICE_USDC:-0.001}}"
EXTRACT_PRICE="${EXTRACT_PRICE:-${WEBCAP_X402_EXTRACT_PRICE_USDC:-0.01}}"
AUDIT_PRICE="${AUDIT_PRICE:-${WEBCAP_X402_AUDIT_PRICE_USDC:-0.002}}"
VIDEO_PRICE="${VIDEO_PRICE:-${WEBCAP_X402_VIDEO_PRICE_USDC:-0.005}}"
COMPUTE_COST="${COMPUTE_COST:-${WEBCAP_COMPUTE_COST_USDC_PER_REQUEST:-0.0002}}"

# --- Derived URL ---
PUBLIC_BASE_URL="${WEBCAP_PUBLIC_BASE_URL:-https://${APP_NAME}.fly.dev}"

# --- CDP keys (optional, for mainnet Bazaar listing) ---
CDP_KEY_ID="${CDP_API_KEY_ID:-}"
CDP_KEY_SECRET="${CDP_API_KEY_SECRET:-}"

# --- Build the secrets set command ---
SECRETS=(
  "WEBCAP_CHAIN=${CHAIN}"
  "X402_FACILITATOR_URL=${FACILITATOR}"
  "WEBCAP_X402_PRICE_USDC=${X402_PRICE}"
  "WEBCAP_X402_EXTRACT_PRICE_USDC=${EXTRACT_PRICE}"
  "WEBCAP_X402_AUDIT_PRICE_USDC=${AUDIT_PRICE}"
  "WEBCAP_X402_VIDEO_PRICE_USDC=${VIDEO_PRICE}"
  "WEBCAP_COMPUTE_COST_USDC_PER_REQUEST=${COMPUTE_COST}"
  "WEBCAP_PUBLIC_BASE_URL=${PUBLIC_BASE_URL}"
  "WEBCAP_PORT=8080"
  "POLL_INTERVAL_MS=30000"
)

# Merchant key (private key or address)
if [ -n "$MERCHANT_KEY" ]; then
  SECRETS+=("USDC_MERCHANT_PRIVATE_KEY=${MERCHANT_KEY}")
elif [ -n "$MERCHANT_ADDRESS" ]; then
  SECRETS+=("WEBCAP_MERCHANT_ADDRESS=${MERCHANT_ADDRESS}")
fi

# CDP keys (optional)
if [ -n "$CDP_KEY_ID" ] && [ -n "$CDP_KEY_SECRET" ]; then
  SECRETS+=("CDP_API_KEY_ID=${CDP_KEY_ID}")
  SECRETS+=("CDP_API_KEY_SECRET=${CDP_KEY_SECRET}")
fi

echo "==> setting ${#SECRETS[@]} secrets for app '$APP_NAME'"
echo "    chain:      $CHAIN"
echo "    facilitator: $FACILITATOR"
echo "    price:      \$${X402_PRICE}/capture"
echo "    base URL:   $PUBLIC_BASE_URL"
echo

# Use flyctl or fly
FLY="flyctl"
command -v fly >/dev/null 2>&1 && FLY="fly"

$FLY secrets set "${SECRETS[@]}" --app "$APP_NAME"

echo
echo "==> secrets set successfully"
echo "    Verify: $FLY secrets list --app $APP_NAME"
