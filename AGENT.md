# Using webcap (for AI agents)

webcap turns any URL into a screenshot, OG metadata, or **structured content
(title, headings, paragraphs, links, images + clean document-order markdown)**,
and runs scheduled page monitors. Payment is per-request in USDC over **x402
(HTTP 402)** on Base mainnet (`eip155:8453`). No registration, no credits. The payer
is **gasless**: it signs an EIP-3009 authorization; the facilitator submits the
on-chain USDC transfer and pays gas.

## Discover (free, no payment)

```bash
curl -s https://<webcap-url>/v1/x402/service
```
Returns all three paid endpoints with exact prices, the network/asset/`payTo`,
the facilitator, and the exact payment flow (`howToPay`). Also free:
- `GET /.well-known/x402` + `GET /.well-known/agent-card.json`: machine discovery.
- `GET /openapi.json`: full OpenAPI 3.1 catalog (incl. the 402 challenge schema).
- `GET /v1/og?url=...`: OG metadata (title, description, image, icon).
- `GET /v1/extract/preview?url=...`: a bounded structured preview (title, top
  headings, links, word count, trimmed markdown). Rate-limited 10/min/peer IP;
  a 429 carries `detail.retryAfterSeconds` + `Retry-After`. Pay for the full
  extract.

## Paid endpoints

| Endpoint | Price (default) | Body | Returns |
|---|---|---|---|
| `POST /v1/x402/capture` | $0.001 (1000 units) | `{"url": "https://...", "format": "png"\|"jpeg"\|"pdf"?}` | base64 PNG/JPEG/PDF + persistent public `artifact.url` + free OG |
| `POST /v1/x402/extract` | $0.01 (10000 units) | `{"url": "https://..."}` or `{"urls": ["...", ...], "schema": "describe the JSON you want"}` | structured JSON. Single URL, or a **batch of up to 10 URLs for one payment** |
| `POST /v1/x402/audit` | $0.002 (2000 units) | `{"url": "https://..."}` | SEO basics + link/OG health in one call |
| `POST /v1/x402/watches/topup` | $0.10 capture-pack / $1.00 extract-pack (100000 / 1000000 units) | `{"watchId": "<id>", "runs": 100}` + `?watchId=<id>` on the unpaid call | `{"watchId", "credits", "priceUsdcUnits"}`. **100 pre-paid monitor runs** |

A `schema` plus a server-configured model also returns an `extracted` object;
the deterministic structure (incl. `markdown`) is always returned regardless.

**Watches** are created free and start with 0 credits:

```bash
curl -s -X POST https://<webcap-url>/v1/watches -H 'content-type: application/json' \
  -d '{"url":"https://example.com","every":"1h","mode":"extract","webhook":"https://you/hook"}'
# → 201 { "id": "<uuid>", "state": { "credits": 0, "paused": false, "…": "…" } }
```
The first run is due immediately; with 0 credits it is recorded `no-credit`
and the watch pauses until the first top-up. Each executed run costs 1 credit;
only `changed` runs fire the webhook.
`every` is `15m` | `1h` | `6h` | `24h`; `mode` is `capture` | `extract` (the
mode picks the top-up pack price); `webhook` is https-only. Inspect with
`GET /v1/watches/:id` (state + last ~10 runs), remove with
`DELETE /v1/watches/:id`. On the unpaid top-up call, include `?watchId=<id>` so
the 402 challenge quotes the exact pack price for that watch.

### How the payment works
1. `POST` unpaid → `402` with a `payment-required` header (base64 x402 v2
   challenge; the JSON body mirrors it).
2. Sign a gasless EIP-3009 `transferWithAuthorization` (`from`=your EOA,
    `to`=challenge `payTo`, `value`=challenge `amount`, EIP-712 domain from
    challenge `extra`): **no ETH/gas needed**.
3. Retry with the signed payload in the `PAYMENT-SIGNATURE` header.
4. The facilitator verifies + settles on-chain; you get the result + a
   `payment-response` settlement receipt (tx hash).

### One-liner (this repo)
```bash
X402_CUSTOMER_PRIVATE_KEY=0x... npx tsx scripts/x402-pay.ts "https://example.com" https://<webcap-url>
# or a batch + schema (one payment covers the whole batch):
X402_CUSTOMER_PRIVATE_KEY=0x... npx tsx scripts/extract-pay.ts \
  '{"urls":["https://a.com","https://b.com"],"schema":"company name + tagline"}' https://<webcap-url>
```
Any x402 v2 client works (`@x402/axios` `wrapAxiosWithPayment`). The payer EOA
only needs a USDC balance on the challenge's network (Base mainnet USDC
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; 6 decimals): no ETH.

## Chain / mainnet

The public service runs on **Base mainnet** (`WEBCAP_CHAIN=base`, CDP
facilitator `https://api.cdp.coinbase.com/platform/v2/x402`). Chain is a
config-only switch: `WEBCAP_CHAIN=base-sepolia` → testnet USDC
(`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, `eip155:84532`, default testnet
facilitator `https://x402.org/facilitator`); `base` → real USDC. The merchant
EOA is a recipient only: no ETH, no pre-existing USDC balance (gasless
EIP-3009 settlement transfers payer → merchant directly). Bazaar discovery
metadata is embedded in the 402 challenges; CDP facilitator auth is optional
via CDP_API_KEY_ID/CDP_API_KEY_SECRET (Ed25519 JWT, default off).

## Notes
- **Batch economics**: one flat extract price covers up to 10 URLs, so a batch
  is cheaper per URL than single calls. Prefer batching your research.
- Errors are `{"error":{"code","message"}}` (+ optional `detail`); a 429's
  `detail.retryAfterSeconds` tells you when to retry. Upstream page failures
  are `502 capture_failed` / `extract_failed`; an x402 route on a local chain
  is `503 x402_disabled`.
- Verify a route's challenge without paying: CDP's public validator,
  `POST https://api.cdp.coinbase.com/platform/v2/x402/validate` with
  `{"resource":"<url>","protocol":"x402"}` → `{valid, simulation, preflight}`.
