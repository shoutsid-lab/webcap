# webcap

webcap is a pay-per-call web capture API. Call a URL, get a screenshot, structured
page data, or a scheduled page monitor. Payment is **x402 (HTTP 402)** USDC
micropayments on **Base mainnet** (`eip155:8453`): no accounts, no API keys, no
credits, and the payer never pays gas.

Live: `https://nickname-trident-driveway.ngrok-free.dev`
Merchant wallet (recipient only): `0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e`

## Paid routes

| Route | Price (default) | You get |
|---|---|---|
| `POST /v1/x402/capture` | **$0.001** (1000 atomic USDC units) | Screenshot as PNG/JPEG/PDF (base64) + a **persistent public artifact link** + free OG metadata |
| `POST /v1/x402/extract` | **$0.01** (10000 units) | Structured page data as JSON (title, description, headings h1-h3, paragraphs, links, images, word count, document-order markdown). One URL, or a **batch of up to 10 URLs for one payment** |
| `POST /v1/x402/watches/topup` | **$0.10** capture-pack / **$1.00** extract-pack | **100 pre-paid runs** of an existing scheduled monitor (watch mode sets which pack price applies) |

Chain, prices, asset, and `payTo` are config-driven (`WEBCAP_CHAIN` selects the
chain table in `src/config.ts`; the live deployment runs `WEBCAP_CHAIN=base`).
Base Sepolia remains a supported testnet option, and a local Anvil chain
disables x402 (the paid routes return `503 x402_disabled`).

### `POST /v1/x402/capture`

Body `{"url": "https://..."}`; optional `format` (`png` | `jpeg` | `pdf`, default
`png`) and `options` (`timeoutMs`, `fullPage`).

```json
{
  "artifact": { "format": "png", "bytes": 48213, "data": "iVBORw0KGgo...", "url": "https://<base>/v1/artifacts/<uuid>" },
  "payment": { "payer": "0x...", "priceUsdcUnits": 1000 }
}
```

`artifact.url` is a persistent, no-auth public link to the stored screenshot
(there is also a shareable HTML page with OG tags at `artifact.url + "/page"`).

### `POST /v1/x402/extract`

Body `{"url": "https://..."}` or `{"urls": ["...", "..."], "schema": "..."}`
(batches up to 10 URLs; one flat price covers the whole batch, so batches carry
higher margin per URL). `schema` is an optional natural-language description of
the JSON you want; when a model is configured server-side (`MODEL_*` vars) it
adds an `extracted` object on top of the deterministic structure, which is
always returned as a floor.

```json
{
  "results": [
    { "url": "https://example.com/", "status": "ok", "data": { "title": "Example Domain", "headings": [{ "level": 1, "text": "Example Domain" }], "paragraphs": ["..."], "links": [{ "href": "...", "text": "..." }], "images": [], "wordCount": 19, "markdown": "# Example Domain\n\n..." } }
  ],
  "payment": { "payer": "0x...", "priceUsdcUnits": 10000 }
}
```

One URL failing in a batch still returns `200` (that entry is
`status: "error"`); only if **all** URLs fail does the request `502`
(`extract_failed`).

### `POST /v1/x402/watches/topup`

Watches are created **free** (`POST /v1/watches`, see Free surface) and start
with 0 credits. The top-up sells exactly `runs: 100` per pack, priced at the
watch's mode unit price × 100:

- capture-mode watch → $0.10 (100000 units)
- extract-mode watch → $1.00 (1000000 units)

Body `{"watchId": "<id>", "runs": 100}`. Include `?watchId=<id>` on the first
(unpaid) request too: the 402 challenge resolves the watch from that query
parameter, so the challenge quotes the exact pack price for that watch before
you sign anything. An unknown watch falls back to the capture-pack price in the
challenge, then 404s with no charge.

```json
{ "watchId": "0f8f...", "credits": 100, "priceUsdcUnits": 100000 }
```

Each **executed** run consumes 1 credit (ok or error); a watch at 0 credits
records a `no-credit` run and pauses until the next top-up. Change detection:
capture runs hash the artifact bytes (sha256), extract runs diff the extract
JSON field-by-field; the first run stores the baseline (`changed: false`). Only
a `changed` run posts to the watch's webhook (if set), with the diff summary.
Runs are recorded in the watch state (`GET /v1/watches/:id`).

## How payment works (x402 v2, gasless)

1. `POST` a paid route with no payment → `HTTP 402` + a `payment-required`
   header carrying a base64 x402 v2 challenge. The JSON body mirrors the same
   challenge (curl/agent-friendly). A `GET` on any paid route returns the same
   402 payment challenge (the `accepts` offer is identical), so crawlers and
   indexers can discover and verify the routes without paying.
2. Read `accepts[0]`: `scheme: "exact"`, `network`, `asset` (the USDC contract),
   `amount` (atomic 6-decimal USDC units), `payTo` (merchant), and `extra`
   (the EIP-712 domain of that chain's USDC deploy, needed to sign).
3. Sign a **gasless** EIP-3009 `transferWithAuthorization`: `from` = your EOA,
   `to` = `payTo`, `value` = `amount`, domain from `extra`. You do not broadcast
   anything.
4. Retry the same request with the signed payload (base64) in the
   `PAYMENT-SIGNATURE` header. The facilitator verifies the signature **and
   your real on-chain USDC balance**, submits the on-chain transfer, and pays
   gas. You get the result plus a `payment-response` settlement receipt (tx hash).

Real 402 from the live service (2026-09-06, `GET /v1/x402/capture`):

```
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwicmVzb3VyY2UiOnsidXJsIjoiaHR0cHM6Ly9uaWNrbmFtZS10cmlkZW50LWRyaXZld2F5Lm5ncm9rLWZyZWUuZGV2L3YxL3g0MDIvY2FwdHVyZSJ9...

{ "x402Version": 2, "error": "Payment required",
  "resource": { "url": "https://nickname-trident-driveway.ngrok-free.dev/v1/x402/capture", "serviceName": "Webcap", "tags": ["screenshot", "web-capture", "pdf", "markdown", "text-extraction"], "iconUrl": "https://.../icon.png", "…": "…" },
  "accepts": [ { "scheme": "exact", "network": "eip155:8453", "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "amount": "1000", "payTo": "0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e", "maxTimeoutSeconds": 300, "extra": { "name": "USD Coin", "version": "2" } } ],
  "extensions": { "bazaar": { "…": "CDP Bazaar discovery extension: example input/output + full request schema" } } }
```

### Copy-paste client (`@x402/axios`)

```ts
import axios from 'axios';
import { x402Client, wrapAxiosWithPayment, decodePaymentResponseHeader } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

// Payer EOA: needs USDC on Base mainnet. No ETH, no gas (the facilitator submits the transfer).
const payer = privateKeyToAccount(process.env.PAYER_KEY as `0x${string}`);
const client = new x402Client().register('eip155:*', new ExactEvmScheme(payer));
const api = wrapAxiosWithPayment(
  axios.create({ baseURL: 'https://nickname-trident-driveway.ngrok-free.dev' }),
  client,
);

// Unpaid POST → 402 + payment-required header → sign EIP-3009 → retry with PAYMENT-SIGNATURE.
const { data, headers } = await api.post('/v1/x402/capture', { url: 'https://example.com', format: 'png' });
console.log(data.artifact.url);  // persistent public screenshot link
console.log(data.payment);       // { payer: '0x…', priceUsdcUnits: 1000 }

const receipt = decodePaymentResponseHeader(String(headers['payment-response']));
console.log(receipt.success, receipt.transaction); // settlement tx hash (basescan.org)
```

The wrapper does the whole 402 → sign → retry loop. The same pattern works for
`/v1/x402/extract` and `/v1/x402/watches/topup` (any x402 v2 client works).
This repo ships the same flow as runnable scripts:

```bash
X402_CUSTOMER_PRIVATE_KEY=0x... npx tsx scripts/x402-pay.ts https://example.com [base-url]
X402_CUSTOMER_PRIVATE_KEY=0x... npx tsx scripts/extract-pay.ts "https://example.com" [base-url]
# or a batch + schema (one payment covers the batch):
X402_CUSTOMER_PRIVATE_KEY=0x... npx tsx scripts/extract-pay.ts \
  '{"urls":["https://a.com","https://b.com"],"schema":"company name + tagline"}' [base-url]
```

## Who needs what (funding)

- **Merchant: nothing to fund.** Settlement is a gasless EIP-3009
  `transferWithAuthorization` payer → merchant. The facilitator submits the
  on-chain transfer and pays gas, so the merchant wallet
  (`0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e`) never signs or broadcasts a
  transaction: no seed USDC, no ETH, no gas. The first payment lands in it
  directly.
- **Payer: USDC on Base mainnet** (6 decimals; $0.001 = 1000 atomic units).
  The payer only signs the authorization; the (relayed) on-chain transfer is
  submitted by the facilitator, which covers gas. The facilitator checks the
  payer's real on-chain USDC balance during verification, so an empty balance
  gets a `402` with `invalid_exact_evm_insufficient_balance`, not a silent
  failure.
- **Facilitator (live):** CDP, `https://api.cdp.coinbase.com/platform/v2/x402`
  (auth optional, via `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`). The testnet
  default is `https://x402.org/facilitator` (Base Sepolia).

## Free surface (no payment)

| Endpoint | Notes |
|---|---|
| `GET /v1/extract/preview?url=...` | Bounded structured preview (title, description, top 5 headings, top 10 links, word count, ≤1500 chars of markdown). **Rate-limited 10/min per peer IP**; a `429` carries `detail.retryAfterSeconds` and a matching `Retry-After` header |
| `GET /v1/og?url=...` | OG link-preview metadata (fields omitted when the page has none) |
| `POST /v1/watches` | Create a scheduled monitor (free; rate-limited 10/min per peer IP). Body `{"url": "https://...", "every": "15m"\|"1h"\|"6h"\|"24h", "mode": "capture"\|"extract"}` + optional `schema` (string) and `webhook` (https-only). Starts with 0 credits: the first (immediately due) run is recorded `no-credit` and the watch pauses until the first top-up. `GET /v1/watches/:id` (state + last ~10 runs), `DELETE /v1/watches/:id` (`204`) |
| `GET /v1/x402/service` | Canonical agent-discoverable descriptor: all 3 paid endpoints + prices, network/asset/`payTo`/facilitator, the exact payment flow, and the free endpoints |
| `GET /.well-known/x402` + `GET /.well-known/agent-card.json` | Machine discovery: x402 catalog + an A2A-style agent card with an x402 payments section |
| `GET /openapi.json` | Full OpenAPI 3.1 catalog of every route (incl. the 402 challenge schema) |
| `GET /v1/health` | Liveness + chain (log-silent, used by the compose healthcheck) |
| `GET /v1/artifacts/:id` (+ `/:id/page`) | Public artifact bytes / shareable page with OG tags |
| `GET /`, `/robots.txt`, `/sitemap.xml`, `/icon.png` | Landing page (content-negotiated: pure-JSON clients get the JSON front door), crawler directives, sitemap |

Real responses (live, 2026-09-06):

```bash
$ curl -s https://nickname-trident-driveway.ngrok-free.dev/v1/health
{"ok":true,"chainId":8453,"creditsPerUsdc":100,"pricePerCredit":0.01}

$ curl -s "https://nickname-trident-driveway.ngrok-free.dev/v1/og?url=https://example.com"
{"url":"https://example.com/","title":"Example Domain","icon":"data:,"}

$ curl -s "https://nickname-trident-driveway.ngrok-free.dev/v1/extract/preview?url=https://example.com"
{"url":"https://example.com","preview":{"title":"Example Domain","description":"","headings":[{"level":1,"text":"Example Domain"}],"links":[{"href":"https://iana.org/domains/example","text":"Learn more"}],"wordCount":19,"markdown":"# Example Domain\n\nThis domain is for use in documentation examples without needing permission. Avoid use in operations.\n\nLearn more"},"truncated":true,"upgrade":{"endpoint":"POST /v1/x402/extract","note":"paid: full paragraphs + images + batch (up to 10 URLs) + optional model extraction"}}
```

`GET /v1/x402/service` (live; long `note`/`howToPay` values abridged):

```json
{ "service": "webcap", "paymentProtocol": "x402", "x402Version": 2,
  "paidEndpoints": [
    { "method": "POST", "path": "/v1/x402/capture", "priceUsdc": 0.001, "atomicUnits": "1000", "…": "…", "note": "screenshot artifact (base64) + free OG metadata" },
    { "method": "POST", "path": "/v1/x402/extract", "priceUsdc": 0.01, "atomicUnits": "10000", "…": "…", "note": "structured content (title, headings, paragraphs, links, images) as JSON; one payment covers a batch" },
    { "method": "POST", "path": "/v1/x402/watches/topup", "priceUsdc": 0.1, "atomicUnits": "100000", "usdcMax": 1, "…": "…", "note": "Pre-pay 100 scheduled monitor runs of an existing watch (capture-pack price shown; extract-pack is usdcMax; exact price quoted per watch via ?watchId=)" } ],
  "price": { "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "network": "eip155:8453", "payTo": "0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e", "scheme": "exact" },
  "howToPay": "POST /v1/x402/capture or /v1/x402/extract unpaid -> HTTP 402 with a base64 x402 v2 challenge (payment-required header) -> sign a gasless EIP-3009 transferWithAuthorization (from=your wallet, to=price.payTo, value=price.atomicUnits) -> retry with the PAYMENT-SIGNATURE header. …",
  "facilitator": "https://api.cdp.coinbase.com/platform/v2/x402",
  "freeEndpoints": [ "…", "…", "…" ] }
```

## Error contract

Every error uses the envelope `{"error": {"code": "...", "message": "..."}}`
with an optional `detail`. Verified against `src/util/errors.ts`,
`src/server/{routes,watches,server}.ts`, and the live service:

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed JSON request body; watch-route input errors (`/v1/watches*` bodies validate as 400: url/every/mode/webhook/watchId/runs) |
| 401 | `unauthorized` | Missing or invalid `Authorization: Bearer wc_live_...` key (legacy rail) |
| 402 | `payment_required` | x402 challenge on a paid route: `PAYMENT-REQUIRED` header (base64 x402 v2 challenge) + mirrored JSON body (the body is the challenge object, not the envelope). Legacy rail: `insufficient_credits` on `POST /v1/capture`, with the auto top-up invoice in `detail` (`invoiceId`, `requiredUsdc`, `balance`) |
| 403 | `forbidden` | `GET /v1/ledger` is merchant-only (any other key); `POST /v1/register` with the merchant address is blocked on live chains |
| 404 | `not_found` | Unknown route or resource (route, artifact, watch). Every 404 uses the envelope |
| 405 | `method_not_allowed` | Valid path, wrong method. Carries an `Allow` header listing the valid methods |
| 422 | `unprocessable` | Input validation on the capture/extract/legacy routes (url, format, options, address, credits, preview `url`, extract `urls`/`schema`) |
| 429 | `rate_limited` | `detail.retryAfterSeconds` + a matching `Retry-After` header (integer seconds); preview 10/min/peer, register 3/min/peer, watch mutations 10/min/peer |
| 500 | `internal` | Unhandled error (message is sanitized to `internal server error`) |
| 502 | `capture_failed` / `extract_failed` | Upstream failure: page load failed (capture/og/preview) / all URLs in an extract batch failed |
| 503 | `x402_disabled` | x402 routes + `/v1/x402/service` when `WEBCAP_CHAIN=local` (no real USDC deploy) |

Real examples (live, 2026-09-06):

```bash
$ curl -si https://nickname-trident-driveway.ngrok-free.dev/nope
HTTP/2 404
{"error":{"code":"not_found","message":"route not found"}}

$ curl -si -X DELETE https://nickname-trident-driveway.ngrok-free.dev/v1/health
HTTP/2 405
allow: GET, HEAD
{"error":{"code":"method_not_allowed","message":"method not allowed"}}
```

## Legacy rail (pre-x402, credits)

The original account/credits API still works alongside x402. Labeled here so
agents and humans don't confuse the two rails: x402 is the product, this rail
predates it.

1. `POST /v1/register`: unauthenticated upsert by wallet address; returns a
   `wc_live_` API key (shown once) + account. Rate-limited 3/min per peer IP.
   `422` on missing/invalid address; **`403` when the address is the merchant
   address on a live chain** (merchant identity is granted out-of-band by ops,
   see the runbook below).
2. `POST /v1/invoice`: auth. Body `{"credits": 100}` (optional positive
   integer, default 100). `1 USDC = 100 credits`, `1 credit = $0.01`;
   `requiredUsdc = credits / 100`; invoices expire after 1h. The customer
   transfers USDC (6 decimals) to the invoice's `merchant` address; a poller
   (every `POLL_INTERVAL_MS`, default 30s) reads ERC-20 `Transfer` logs to the
   merchant and settles the oldest open, non-expired invoice a transfer covers
   (`credits = floor(paidUSdc × 100)`; atomic + idempotent via
   `UNIQUE(tx_hash, log_index)`).
3. `POST /v1/capture`: auth. 1 credit per capture; invalid URL `422` (no
   charge); balance too low → `402` with an auto top-up invoice in `detail`;
   capture failure → `502` and the credit is refunded. Response includes the
   persistent `artifact.url`.
4. `GET /v1/account`: auth. Balance + invoice list.
5. `GET /v1/ledger`: auth, **merchant-only** (account address must equal
   `config.merchantAddress`; anything else `403`). P&L summary
   (`totalRevenueUsdcUnits`, `totalCostUsdcUnits`, `netMarginUsdcUnits`,
   `requestCount`, `coveringCompute`) + the 50 most recent rows
   (`endpoint`, `payer`, `revenue_usdc`, `cost_usdc`, `net_margin_usdc`).

```bash
curl -s -X POST localhost:8080/v1/register \
  -H 'content-type: application/json' \
  -d '{"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"}'
# → {"address":"0xf39F…2266","apiKey":"wc_live_0159ad23...","balance":0}
```

## Ops runbook

### Deploy

```bash
docker compose build && docker compose up -d
```

`docker-compose.yml` (container `webcap-webcap-1`) already bakes in the
production shape:

- **Loopback bind** `127.0.0.1:8080:8080`: the app is never reachable on host
  interfaces; the public path is the ngrok tunnel (watchdog-managed).
- **Healthcheck**: `GET /v1/health` via node `fetch`, interval 30s / timeout 5s
  / 3 retries / 15s start period; `restart: unless-stopped`.
- **Resource limits**: 2 GB memory, 2 CPUs; json-file log driver capped at
  10 MB × 3 files.
- **Volume**: `webcap-data:/data`, `WEBCAP_DB=/data/webcap.db` inside the
  container (the DB never lives in the image).
- The image is Debian-based (`node:24`) rather than Alpine because the capture
  pipeline runs the `chrome` channel (Google Chrome), which has no musl build.

### Monitoring

```bash
docker compose ps
docker compose logs -f webcap
```

The app logs pino JSON per request: request ids, full request headers, with
`authorization` and `payment-signature` / `payment-required` **redacted**
(censored to `[Redacted]`), 4xx completions at `warn`, and `/v1/health`
log-silent (it is a probe). Host-side logs live under `logs/`
(`webcap-health.log`, `webcap-revenue-alert.log`, `webcap-backup.log`,
`ngrok.log`, `tunnel.log`).

### Watchdogs (host cron)

`crontab -l`:

```
* * * * *        bin/tunnel-watchdog.sh      (+ @reboot)
* * * * *        bin/ngrok-watchdog.sh       (+ @reboot)
*/5 * * * *      bin/webcap-health.sh
*/5 * * * *      bin/webcap-revenue-alert.sh
*/30 * * * *     bin/webcap-backup.sh
30 3 * * 1,4     bin/webcap-keepalive.sh     (Mondays + Thursdays)
```

- `bin/webcap-health.sh` (5 min): requires `GET /v1/x402/service` → 200 **and**
  `POST /v1/x402/capture` → 402 with a `PAYMENT-REQUIRED` header carrying the
  bazaar extension. On failure: `docker compose up -d`, then re-checks the
  service endpoint for up to ~60s and logs `recovered` / `still-down`.
- `bin/webcap-revenue-alert.sh` (5 min): polls the merchant P&L ledger
  (`GET /v1/ledger`, Bearer key from `WEBCAP_LEDGER_API_KEY` in `.env`) and
  logs an `ALERT` line with the summary whenever `requestCount` grows (a new
  paid request settled). Observes only; restarts belong to the health watchdog.
- `bin/webcap-backup.sh` (30 min): online in-container backup
  (`better-sqlite3` `db.backup()` against the live WAL, no downtime) →
  `docker cp` to `backups/webcap-<timestamp>.sqlite` → `PRAGMA integrity_check`
  on the host copy → retain the **7 newest**, `chmod 600`.
- `bin/webcap-keepalive.sh` (2×/week, Mondays + Thursdays 03:30 — a missed
  run is caught up 3 days later, keeping the worst-case settlement gap under
  Bazaar's 30-day delisting window; the 25-day success cooldown bounds the
  actual settlement cadence): keeps the x402 discovery
  presence alive against CDP Bazaar's 30-day no-settlement delisting. Checks
  Bazaar listing presence (CDP validate ×3 + `discovery/merchant`), attempts
  the $0.001 self-settlement via `scripts/x402-pay.ts` (funds loop back to the
  merchant wallet; 25-day success cooldown; non-fatal while the payer wallet
  `X402_CUSTOMER_PRIVATE_KEY` is unfunded — the attempt doubles as the balance
  probe), re-asserts the 402index registration (idempotent upsert on
  url+protocol), and re-registers on x402scan (SIWX, merchant key) only if the
  origin dropped off there. State + receipts: `state/webcap-keepalive.state` +
  `state/webcap-keepalive/`. Dry run: `WEBKEEPALIVE_DRY_RUN=1`.
- `bin/ngrok-watchdog.sh` + `bin/tunnel-watchdog.sh` (1 min): keep the public
  tunnels alive. The ngrok one (stable `*.ngrok-free.dev` subdomain) probes the
  **public URL** `/v1/health`; process alive but URL dead for **3 consecutive
  runs** → exact-pid restart (ngrok reconnects to the same account-bound
  subdomain). The Cloudflare quick tunnel is secondary and the same 3-strike
  liveness applies. Both deliberately avoid `pkill` (pgrep discovery +
  exact-pid kill only).

### SQLite backup / restore

Backups land in `backups/` (retention 7, integrity-checked at backup time).
Restore while the container is **stopped**:

```bash
docker compose down
cp backups/webcap-<timestamp>.sqlite <host path of the webcap-data volume>
docker compose up -d
```

(i.e. copy the file back over `/data/webcap.db` on the `webcap-data` volume.)
Sanity-check any copy with `PRAGMA integrity_check` (the backup script does
this with the repo's `better-sqlite3`; the host has no sqlite3 CLI).

### Merchant API key rotation

On live chains, merchant registration through `POST /v1/register` is
`403`-guarded, so the merchant's API key (used by `GET /v1/ledger` and the
revenue alert) is provisioned out-of-band against the SQLite DB. The ledger
gate passes when the authenticated account's `address` equals
`config.merchantAddress` (case-insensitive), so:

1. Find the merchant account:
   `SELECT id FROM accounts WHERE lower(address) = lower('<merchant address>');`
2. Generate a key: `wc_live_` + 32 hex chars (16 random bytes), and hash it:
   `key_hash = sha256(key)` as a hex digest (that is the only form stored;
   auth compares sha256 in constant time).
3. Insert the new row:
   `INSERT INTO api_keys (account_id, key_hash, name, created_at) VALUES (<merchant account id>, '<key_hash>', 'merchant', '<ISO now>');`
4. Revoke the old row: `UPDATE api_keys SET revoked = 1 WHERE id = <old key id>;`
   (live auth only reads `key_hash` with `revoked = 0`.)
5. Point `WEBCAP_LEDGER_API_KEY` in `.env` at the new key (host-ops secret) and
   restart the container so the revenue alert uses it.

Column reference (`api_keys`): `id`, `account_id`, `key_hash` (UNIQUE), `name`
(default `default`), `created_at`, `last_used_at`, `revoked` (0/1).
(`accounts`: `id`, `credits`, `address`, `created_at`.)

### Configuration

All `WEBCAP_*` variables (plus the model and CDP keys) are documented with
defaults in [`.env.example`](.env.example). Copy it to `.env`. The short
version:

- `WEBCAP_CHAIN` (`base` | `base-sepolia` | `local`) drives the chain table in
  `src/config.ts`: chainId, USDC contract, CAIP-2 network, EIP-712 domain. The
  live deployment is `base`; x402 is disabled only on `local`.
- `USDC_MERCHANT_PRIVATE_KEY` or `WEBCAP_MERCHANT_ADDRESS` (one of the two is
  required to start); `WEBCAP_PUBLIC_BASE_URL` is also required (artifact
  links are built from it).
- Prices: `WEBCAP_X402_PRICE_USDC` (default `0.001`),
  `WEBCAP_X402_EXTRACT_PRICE_USDC` (default `0.01`); the watch top-up price is
  derived (unit price × 100 runs, not a separate var).
- `X402_FACILITATOR_URL` (default `https://x402.org/facilitator`; live uses the
  CDP facilitator), `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` (optional, both or
  neither).

### x402 validator (CDP)

Validate a paid route's challenge without paying (no API key needed):

```bash
curl -s -X POST https://api.cdp.coinbase.com/platform/v2/x402/validate \
  -H 'content-type: application/json' \
  -d '{"resource":"https://nickname-trident-driveway.ngrok-free.dev/v1/x402/capture","protocol":"x402"}'
# → { "valid": true, "simulation": {"outcome":"accepted"}, "preflight": [ {check, detail, passed, severity}, ... ] }
```

Re-verified 2026-09-06: all three paid routes return `valid: true` with
`simulation.outcome: "accepted"` and zero failed preflight checks on
`eip155:8453`.

## CDP Bazaar listing

All three paid routes carry the x402 Bazaar discovery extension (service name
"Webcap", tags, icon at `/icon.png`, example input/output, full request schema)
in their 402 challenges, so the CDP Bazaar catalog (surfaced to agents via CDP
APIs, Bazaar MCP, Amazon Bedrock AgentCore, agentic.market) can discover webcap.

1. Create a free CDP project at https://cdp.coinbase.com and note the API key
   ID + secret.
2. Set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and
   `X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402`.
3. Restart, then make one paid call (e.g. `scripts/x402-pay.ts`): a settlement
   through the CDP facilitator triggers Bazaar indexing.

**Funding flip (testnet → mainnet terms).** A single **mainnet** settlement
flips the Bazaar listings to `eip155:8453` in ~10–15 min, and downstream
directories (402index polls hourly, agent-tools.cloud ~6h) follow within
hours. Procedure: fund the payer wallet
`0xBAc4987c4Bc949f0B2833b6BC7C5B9F7b5B9757B` with ≥ $0.001 USDC on Base, then
run `X402_CUSTOMER_PRIVATE_KEY=… npx tsx scripts/x402-pay.ts
https://example.com <public base URL>`. A real customer payment also triggers
the flip.

**30-day delisting.** Resources with no settlement for 30 days are removed
from the Bazaar catalog and search results
(docs.cdp.coinbase.com/x402/seller/get-discovered). `bin/webcap-keepalive.sh`
(weekly) keeps the listing alive via the gated self-settlement; the 402index
and x402scan registrations are re-asserted by the same script.

## Distribution channels

| Channel | Listing mechanism | Re-asserted by |
|---|---|---|
| CDP Bazaar (catalog, Bazaar MCP, Amazon Bedrock AgentCore, agentic.market) | Settlement through the CDP facilitator indexes the route | `bin/webcap-keepalive.sh` (weekly self-settlement) |
| 402index.io | Direct registration (idempotent upsert on url+protocol) + hourly Bazaar poll | `bin/webcap-keepalive.sh` |
| x402scan.com | SIWX origin registration (merchant wallet signs, auth-only) + OpenAPI crawl; the `x-discovery.ownershipProofs` EIP-191 origin signature served in `/openapi.json` earns the verified-ownership mark | `bin/webcap-keepalive.sh` (only if the listing drops) |
| x402.arena | Health-probe registration (verified) | manual |
| agent-tools.cloud | Auto-crawl of the public URL | n/a |

Agent-facing discovery surfaces: `/llms.txt`, `/skill.md`, `/openapi.json`,
`/.well-known/x402`, `/v1/x402/service`.

## Unit economics

- `capture` $0.001 — priced at the market cluster floor (a volume/discovery
  play); margin ≈ $0.0008/call after the $0.0002 amortized compute cost.
- `extract` $0.01 — margin ≈ $0.0098/call (98%) on deterministic extraction.
  Model-based extraction cost (LLM) is unknown until `MODEL_API_*` is set;
  until then extract is structure-only and the service logs a one-time boot
  warning naming the missing config.
- `watch top-up` $0.10–$1.00 — prepaid recurring rail (100-run packs,
  per-watch challenge pricing).
- Per-request P&L (revenue, amortized cost, net margin) is recorded in the
  ledger: `GET /v1/ledger` with Bearer `WEBCAP_LEDGER_API_KEY` from `.env`.

## Development (local Anvil)

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

> **Note (dev-chain quirk):** `npm run chain:up` mints 10k dev-USDC to *both*
> the customer and the merchant, so the merchant's own dev-mint settles the
> first invoice (to `10000 × 100` credits). To demo a clean pay→settle→capture,
> point `WEBCAP_MERCHANT_ADDRESS` at a **fresh** wallet (never minted) and pay
> from the customer. That is exactly the public-loop proof in `artifacts/PROOF.md`.
> On `local`, the x402 routes return `503 x402_disabled` (the credit rail is
> the test path there).

## Tests

```bash
npm test           # 357 tests (46 files): unit + API + e2e; anvil + local http fixtures only, no internet
npm run typecheck
```

## Proof

Live evidence (mainnet flip, CDP validator verdicts for all three routes,
settlement receipts) is in [`artifacts/PROOF.md`](artifacts/PROOF.md).
