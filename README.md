# webcap

Capture any URL as PNG/JPEG/PDF, or fetch its OG link-preview metadata —
metered in credits, paid with on-chain USDC (Base mainnet, Base Sepolia, or a
local Anvil chain).

## Payment → capture loop

1. `POST /v1/register` — upsert an account by wallet address, mint a `wc_live_` API key (returned once).
2. `POST /v1/invoice` — price a credit purchase: `requiredUsdc = credits / 100`, payable to the merchant EOA.
3. The customer transfers USDC (6 decimals) to the invoice's `merchant` address on-chain.
4. A poller (every `POLL_INTERVAL_MS`) reads ERC-20 `Transfer` logs to the merchant and settles the oldest open, non-expired invoice a transfer covers. Credits granted = `floor(paidUSdc × 100)`. Settlement is atomic and idempotent (`UNIQUE(tx_hash, log_index)`).
5. `POST /v1/capture` — 1 credit per capture (0.01 USDC). Balance too low → `402` with an auto top-up invoice; capture failure → `502` and the credit is refunded.

## API

Base URL `http://localhost:8080`. Authenticated routes take
`Authorization: Bearer wc_live_<key>`. Errors:
`{"error":{"code": "...", "message": "...", "detail": ...}}`.

### `GET /v1/health` — public

```bash
curl -s localhost:8080/v1/health
```
```json
{ "ok": true, "chainId": 31337, "creditsPerUsdc": 100, "pricePerCredit": 0.01 }
```

### `POST /v1/register` — public

Body `{"address": "0x..."}`. Upsert: repeating an address mints a new key for
the same account. `422` on missing/invalid address.

```bash
curl -s -X POST localhost:8080/v1/register \
  -H 'content-type: application/json' \
  -d '{"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"}'
```
```json
{ "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", "apiKey": "wc_live_0159ad23...", "balance": 0 }
```

### `POST /v1/invoice` — auth

Body `{"credits": 100}` (optional, positive integer, default 100).

```bash
curl -s -X POST localhost:8080/v1/invoice \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"credits":100}'
```
```json
{ "invoiceId": "1", "merchant": "0xe4bD4D...", "token": "0x5FbDB2...", "chainId": 31337, "requiredUsdc": 1, "credits": 100, "expiresAt": "2026-09-04T19:31:00.000Z" }
```

### `POST /v1/capture` — auth

Body `{"url", "format": "png"|"jpeg"|"pdf", "options": {"timeoutMs", "fullPage"}}`
(format/options optional; defaults `png`). Invalid URL → `422`, no charge.

```bash
curl -s -X POST localhost:8080/v1/capture \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"url":"https://example.com","format":"png"}'
```
```json
{ "artifact": { "format": "png", "bytes": 48213, "data": "iVBORw0KGgo..." }, "creditsCharged": 1, "balance": 99 }
```
`402` (auto top-up invoice in `detail`):
```json
{ "error": { "code": "insufficient_credits", "message": "insufficient credits", "detail": { "invoiceId": "2", "requiredUsdc": 0.01, "balance": 0 } } }
```
`502` on capture failure (credit refunded):
```json
{ "error": { "code": "capture_failed", "message": "capture failed for https://...: ..." } }
```

### `GET /v1/og` — public

Query `?url=...`. Fields omitted when the page has no such meta.

```bash
curl -s "localhost:8080/v1/og?url=https://example.com"
```
```json
{ "url": "https://example.com", "title": "Example Domain", "description": "...", "image": "...", "icon": "..." }
```

### `GET /v1/account` — auth

```bash
curl -s localhost:8080/v1/account -H "authorization: Bearer $KEY"
```
```json
{ "address": "0xf39Fd6...", "balance": 100, "invoices": [ { "id": "1", "status": "paid", "credits": 100, "requiredUsdc": 1, "createdAt": "..." } ] }
```

## Credits

| | |
|---|---|
| 1 USDC | 100 credits |
| 1 capture | 1 credit (0.01 USDC) |

Invoice pricing is always `credits / 100` USDC; `starter` / `pro` / `max` are
label tiers for common sizes (100 / 1000 / 10000 credits).

## Running locally (Anvil)

```bash
npm install
export PATH="$HOME/.foundry/bin:$PATH"
npm run chain:up    # anvil on :8545 + mintable USDC, 10k USDC to anvil account #0
                    # -> /tmp/webcap-chain.json (rpcUrl, usdcContract, merchant, customer)

WEBCAP_CHAIN=local \
WEBCAP_USDC_ADDRESS=$(jq -r .usdcContract /tmp/webcap-chain.json) \
WEBCAP_MERCHANT_ADDRESS=$(jq -r .merchant.address /tmp/webcap-chain.json) \
POLL_INTERVAL_MS=1000 \
npm start
```

Full loop:

```bash
KEY=$(curl -s -X POST localhost:8080/v1/register -H 'content-type: application/json' \
  -d "{\"address\":\"$(jq -r .customer.address /tmp/webcap-chain.json)\"}" | jq -r .apiKey)
curl -s -X POST localhost:8080/v1/invoice -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"credits":100}'
# pay 1.0 USDC (1_000_000 base units) customer -> merchant
cast send --rpc-url http://127.0.0.1:8545 \
  --private-key "$(jq -r .customer.privateKey /tmp/webcap-chain.json)" \
  "$(jq -r .usdcContract /tmp/webcap-chain.json)" \
  "transfer(address,uint256)" "$(jq -r .merchant.address /tmp/webcap-chain.json)" 1000000
curl -s -X POST localhost:8080/v1/capture -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"url":"https://example.com","format":"png"}'
> **Note (dev-chain quirk):** `npm run chain:up` mints 10k dev-USDC to *both*
> the customer and the merchant, so the merchant's own dev-mint settles the
> first invoice (to `10000 × 100` credits). To demo a clean pay→settle→capture,
> point `WEBCAP_MERCHANT_ADDRESS` at a **fresh** wallet (never minted) and pay
> from the customer — exactly the public-loop proof in `artifacts/PROOF.md`.

## Deploy to a public endpoint (production)

webcap is self-hosted: run it on any always-on machine and front it with a
public HTTPS endpoint. For a live business point it at Base mainnet USDC with
your own merchant key; for a safe demo use Base Sepolia.

**1. Configure** — copy `.env.example` to `.env` and set:
```
WEBCAP_CHAIN=base-sepolia            # or `base` for live USDC
USDC_MERCHANT_PRIVATE_KEY=0x<your-merchant-eoa-key>
WEBCAP_PORT=8080
POLL_INTERVAL_MS=30000
WEBCAP_DB=./data/webcap.db
```
The merchant EOA only *receives* USDC (it does not pay gas); fund it with the
chain's native token only if you ever let it send transactions.

**2. Run the service**:
```
npm ci
npm start        # listens on :8080 and starts the settlement poller
```

**3. Expose it publicly** — Cloudflare Quick Tunnel (no account or domain
needed; the URL is stable for as long as the process runs):
```
bin/cloudflared tunnel --url http://localhost:8080 --no-autoupdate
# prints:  https://<random>.trycloudflare.com   <- your public endpoint
```
`bin/cloudflared` is a committed static binary; for a fixed production domain
use your own Cloudflare Tunnel / ingress / reverse proxy instead.

Customers then call `https://<endpoint>/v1/...`; USDC payments arrive on-chain
to your merchant EOA and settle automatically. The full public loop is proven in
`artifacts/PROOF.md` (localhost SURFACE + the clean public payment loop).

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `WEBCAP_CHAIN` | `base-sepolia` | `base` \| `base-sepolia` \| `local` |
| `WEBCAP_PORT` | `8080` | HTTP port |
| `USDC_MERCHANT_PRIVATE_KEY` | — | merchant EOA key; USDC is received at the derived address |
| `WEBCAP_MERCHANT_ADDRESS` | — | merchant address when no key is set; one of the two is required to start |
| `WEBCAP_RPC_URL` | `http://127.0.0.1:8545` | local chain only |
| `WEBCAP_USDC_ADDRESS` | — (required local) | local USDC contract (`LOCAL_USDC_CONTRACT` is an alias) |
| `POLL_INTERVAL_MS` | `30000` | poller cadence |
| `WEBCAP_DB` | `data/webcap.db` | SQLite file (WAL) |
| `WEBCAP_CAPTURE_ALLOW_HOSTS` | — | comma-separated hosts the capture endpoint may load despite the private-IP guard (local dev) |
| `WEBCAP_X402_PRICE_USDC` | `0.001` | x402 per-request price in USDC (Base only; `local` disables x402) |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` | x402 facilitator (testnet default; use the CDP facilitator on mainnet) |
| `WEBCAP_X402_ASSET` | chain USDC | x402 asset override (default: the chain's USDC) |
| `WEBCAP_X402_PAY_TO` | merchant | x402 payTo override (default: the merchant address) |

## Tests

```bash
npm test           # 108 tests: unit + API + e2e; anvil + local http fixtures only, no internet
npm run typecheck
```

## Docker

```bash
cp .env.example .env    # set WEBCAP_CHAIN + merchant (key or address) + local USDC for local mode
docker compose up --build
```

The image is Debian-based (`node:24`) rather than Alpine because the capture
pipeline runs the `chrome` channel (Google Chrome), which has no musl/Alpine
build. The DB persists in the `webcap-data` volume.

## x402 real USDC payment (Base, per-request, no account)

A standards-based **x402 (HTTP 402)** pay-per-request endpoint. No registration, no
credits — the client pays USDC on the spot. The payer is **gasless**: it signs an
EIP-3009 `transferWithAuthorization`; the facilitator submits the on-chain transfer
and pays gas, and the USDC lands in the merchant wallet.

### `POST /v1/x402/capture` — x402-gated

Unpaid → `402` + a `payment-required` header (base64 x402 v2 challenge). Pay via the
`PAYMENT-SIGNATURE` header (any x402 v2 client) or the bundled agent client:

```bash
# as a paying agent (Base-sepolia; the EOA needs a USDC balance — no ETH needed)
X402_CUSTOMER_PRIVATE_KEY=0x… \
  npx tsx scripts/x402-pay.ts https://example.com https://<your-public-url>
```

- `WEBCAP_CHAIN=base-sepolia` → `eip155:84532`, USDC `0x036C…CF7e` (name `USDC`, v2), facilitator `x402.org`.
- `WEBCAP_CHAIN=base` → `eip155:8453` (mainnet), USDC `0x8335…2913` (name `USD Coin`, v2) — **real money**; point `X402_FACILITATOR_URL` at the CDP facilitator.
- `WEBCAP_CHAIN=local` → the x402 route returns `503` (no public facilitator).

Live proof (a real public 402 challenge + a real facilitator on-chain verification) is
in [`artifacts/PROOF.md`](artifacts/PROOF.md).
