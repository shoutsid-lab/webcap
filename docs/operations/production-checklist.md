# webcap Production Launch Checklist

## Pre-Launch (Before Any Deploy)

### 1. Domain & Branding
- [ ] Choose a domain name (e.g., `webcap.io`, `capture.xyz`)
- [ ] Register the domain
- [ ] Point DNS to Fly.io (or use `fly dns` for automatic `.fly.dev` subdomain)
- [ ] Update `WEBCAP_PUBLIC_BASE_URL` with the final domain

### 2. Merchant Wallet
- [ ] Create a dedicated EOA for receiving USDC (never use your main wallet)
- [ ] Fund with a small amount of ETH for gas (if needed)
- [ ] Note the private key (for `USDC_MERCHANT_PRIVATE_KEY`)
- [ ] Note the address (for `WEBCAP_MERCHANT_ADDRESS`)

### 3. CDP API Key (Mainnet Only)
- [ ] Create a Coinbase Developer Platform account
- [ ] Generate an API key pair (ID + Secret)
- [ ] Store securely — needed for CDP facilitator auth
- [ ] Enables Bazaar listing/indexing

---

## Deploy to Fly.io (Recommended)

### Quick Start (One Command)
```bash
# Testnet (no real money)
./deploy/deploy-fly.sh

# Mainnet (real USDC)
CHAIN=base MERCHANT_KEY=0x... ./deploy/deploy-fly.sh
```

### Manual Steps

#### Step 1: Install flyctl
```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

#### Step 2: First-time launch
```bash
fly launch --copy-config
fly volume create data --region lhr --size 1
```

#### Step 3: Set secrets
```bash
fly secrets set \
  WEBCAP_CHAIN=base \
  USDC_MERCHANT_PRIVATE_KEY=0x... \
  X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402 \
  WEBCAP_PUBLIC_BASE_URL=https://webcap.yourdomain.com \
  CDP_API_KEY_ID=... \
  CDP_API_KEY_SECRET=...
```

#### Step 4: Deploy
```bash
fly deploy --remote-only
```

#### Step 5: Verify
```bash
curl https://webcap.yourdomain.com/v1/health
```

---

## Alternative: Cloudflare Named Tunnel

If you prefer Cloudflare over Fly.io:

### Prerequisites
- Cloudflare account with a zone
- API token with `zone:read` + `tunnel:write` scopes

### Setup
```bash
CF_TOKEN=your-token CF_ZONE=yourdomain.com ./deploy/cloudflared/setup-named-tunnel.sh
```

This creates a stable `https://webcap.yourdomain.com` URL.

---

## Alternative: VPS (Self-Hosted)

For full control (Hetzner, DigitalOcean, Vultr):

### Prerequisites
- Ubuntu/Debian VPS with root SSH
- Docker installed

### Deploy
```bash
# From your local machine:
scp -r . root@your-vps:/opt/webcap

# From the VPS:
MERCHANT_KEY=0x... CHAIN=base ./deploy/deploy-vps.sh
```

---

## Post-Deploy Verification

### Health Check
```bash
curl https://your-domain/v1/health
# Expected: {"ok":true,"uptimeSeconds":...,"chainId":8453,...}
```

### Test Capture (Testnet Only)
```bash
# Free preview (no payment required)
curl https://your-domain/v1/x402/capture \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

# With x402 payment (requires wallet)
curl https://your-domain/v1/x402/capture \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","format":"png"}'
```

### Check Artifacts
```bash
# Artifacts should be accessible at the public URL
curl -I https://your-domain/v1/artifacts/<uuid>
```

---

## Switching to Mainnet (Real Money)

### 1. Update Secrets
```bash
fly secrets set \
  WEBCAP_CHAIN=base \
  X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402 \
  CDP_API_KEY_ID=your-cdp-key-id \
  CDP_API_KEY_SECRET=your-cdp-key-secret
```

### 2. Verify Chain
```bash
curl https://your-domain/v1/health
# chainId should be 8453 (Base mainnet)
```

### 3. Test with Small Amount
- Send a test capture request with a funded x402 wallet
- Verify USDC arrives at merchant wallet
- Check transaction on BaseScan: https://basescan.org

---

## Monitoring

### Logs
```bash
fly logs --app webcap
```

### Status
```bash
curl https://your-domain/v1/status
```

### Revenue
```bash
# Requires merchant bearer key
curl -H "Authorization: Bearer <key>" https://your-domain/v1/ledger
```

---

## Troubleshooting

### "x402_disabled" on paid routes
- Check `WEBCAP_CHAIN` is set to `base` or `base-sepolia`
- Verify `X402_FACILITATOR_URL` is correct for your chain

### Capture timeout
- Increase `WEBCAP_CAPTURE_TIMEOUT_MS` (default: 30000ms)
- Check VM memory (Chrome needs ~1GB)

### Artifact URLs broken
- Verify `WEBCAP_PUBLIC_BASE_URL` matches your actual domain
- Ensure the domain has valid SSL certificate

### DB errors
- Check the persistent volume is mounted: `fly volume list --app webcap`
- Verify `/data/webcap.db` is writable
