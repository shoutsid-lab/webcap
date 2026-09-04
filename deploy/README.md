# webcap — 24/7 persistent deployment

webcap runs a Docker image (`Dockerfile` + `docker-compose.yml` at the repo root) that serves
the x402 USDC pay-per-request API on port `8080`. The DB persists on the `webcap-data` volume.
To make it a **stable, always-on public service**, pick ONE host option below. Each needs a
single credential; the service itself is already real + live (see `../artifacts/PROOF.md`).

## Production env (all options)

`webcap.env.template` is the source of truth. The values that matter:

| Var | Value | Notes |
|---|---|---|
| `WEBCAP_CHAIN` | `base-sepolia` \| `base` | `base` = Base **mainnet** = **real money** |
| `USDC_MERCHANT_PRIVATE_KEY` | `0x…` | the self-custody EOA that **receives** the USDC (keep secret, chmod 600) |
| `WEBCAP_X402_PRICE_USDC` | `0.001` | per-request price |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` | testnet, no key. For **mainnet real money** use the CDP facilitator `https://api.cdp.coinbase.com/platform/v2/x402` (needs a CDP key). |

## Option A — Cloudflare named tunnel (stable URL, no VPS) *(lightest)*

A named tunnel gives a **stable** `https://webcap.<your-zone>.com` (unlike the ephemeral Quick
Tunnel). The `cloudflared` process can run on any always-on machine (a small VPS, a home box, or
the same host as the app).

**Needs:** a Cloudflare account + an **API token** with `zone:read` + `tunnel:write`.

```bash
# on the host that runs webcap (localhost:8080), as root:
curl -fsSL https://binaries.cloudflareclient.com/latest/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
CF_TOKEN=<token> CF_ZONE=<your-zone.com> ./deploy/cloudflared/setup-named-tunnel.sh
# -> prints the stable URL https://webcap.<your-zone>.com, runs under systemd (Restart=always)
```

## Option B — VPS (full 24/7, Docker + systemd auto-restart) *(most self-contained)*

A small Ubuntu/Debian VPS (Hetzner, DigitalOcean, Vultr, …). One command builds, installs the
systemd unit (`Restart=always`, survives reboots + crashes), and starts it.

**Needs:** a VPS with root SSH.

```bash
# from the VPS, after git cloning the repo to /opt/webcap:
MERCHANT_KEY=0x… CHAIN=base-sepolia ./deploy/deploy-vps.sh
# -> builds the image, writes /opt/webcap/.env, enables+starts webcap.service, health-checks
# then expose it: Option A's named tunnel (point at localhost:8080) or a firewall port-forward.
```

## Option C — Managed PaaS (Render / Fly.io) *(least ops)*

**Needs:** a Render or Fly.io account.

- **Render**: *New > Blueprint*, point it at `deploy/render.yaml`; set `USDC_MERCHANT_PRIVATE_KEY` as a dashboard secret.
- **Fly.io**: `fly launch` (uses `deploy/fly.toml`) then `fly deploy`; `fly secrets set …` for the merchant key + chain + facilitator.

Both give a stable public HTTPS URL automatically.

## Crash-resilience (any host, safety net)

`supervise.sh` health-checks `:8080/v1/health` every 10s and restarts the app if it drops —
useful on hosts without systemd, or layered on top of the above:

```bash
setsid nohup ./deploy/supervise.sh >/dev/null 2>&1 &   # WEBCAP_DIR auto-detects the repo root
```

## Switching to Base mainnet real money

Set `WEBCAP_CHAIN=base` + `X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402`
(+ your CDP credentials), and the **same** x402 flow pays **real USDC** (asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
EIP-712 name `USD Coin`) into the same merchant wallet.
