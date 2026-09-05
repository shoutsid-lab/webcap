# Using webcap (for AI agents)

webcap turns any URL into a screenshot, OG metadata, or **structured content
(title, headings, paragraphs, links, images + clean document-order markdown)** —
paid per-request in USDC over **x402 (HTTP 402)**. No registration, no credits.
The payer is **gasless**: it signs an EIP-3009 authorization; the facilitator
submits the on-chain USDC transfer and pays gas.

## Discover (free, no payment)

```bash
curl -s https://<webcap-url>/v1/x402/service
```
Returns both paid endpoints, their USDC prices, the network/asset/`payTo`, the
facilitator, and the exact payment flow. Also free:
- `GET /v1/og?url=...` — OG metadata (title, description, image, icon).
- `GET /v1/extract/preview?url=...` — a bounded structured preview (title, top
  headings, links, word count, trimmed markdown). Rate-limited; pay for the full
  extract.

## Pay + get structured content

| Endpoint | Price (default) | Returns |
|---|---|---|
| `POST /v1/x402/capture` | $0.001 | base64 PNG/JPEG/PDF + free OG |
| `POST /v1/x402/extract` | $0.01 | structured JSON — single URL, or a **batch of up to 10 URLs for one payment** |

The extract body is `{"url": "https://..."}` or
`{"urls": ["...", "..."], "schema": "describe the JSON you want"}`. A `schema`
plus a configured model also returns an `extracted` object; the deterministic
structure (incl. `markdown`) is always returned regardless.

### How the payment works
1. `POST` unpaid → `402` with a `payment-required` header (base64 x402 v2 challenge).
2. Sign a gasless EIP-3009 `transferWithAuthorization` (`from`=your EOA,
   `to`=challenge `payTo`, `value`=challenge `amount`) — **no ETH/gas needed**.
3. Retry with the signed payload in the `PAYMENT-SIGNATURE` header.
4. The facilitator verifies + settles on-chain; you get the result + a
   `payment-response` settlement receipt (tx hash).

### One-liner (this repo)
```bash
X402_CUSTOMER_PRIVATE_KEY=0x... npx tsx scripts/extract-pay.ts "https://example.com" https://<webcap-url>
# or a batch + schema (one payment covers the whole batch):
X402_CUSTOMER_PRIVATE_KEY=0x... npx tsx scripts/extract-pay.ts \
  '{"urls":["https://a.com","https://b.com"],"schema":"company name + tagline"}' https://<webcap-url>
```
Any x402 v2 client works (`@x402/axios` `wrapAxiosWithPayment`). The payer EOA
only needs a USDC balance on the challenge's network (e.g. Base Sepolia faucet)
— no ETH.

## Notes
- `WEBCAP_CHAIN=base-sepolia` → testnet USDC (default, safe); `base` → live
  USDC (real money; point the facilitator at CDP).
- **Batch economics**: one flat extract price covers up to 10 URLs, so a batch is
  cheaper per URL than single calls — prefer batching your research.
