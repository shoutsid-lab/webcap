# Reddit r/ethereum Post

**Title:** Show r/ethereum: Webcap - Web capture API that accepts USDC payments via x402 (no accounts, no API keys)

**Body:**

Hey r/ethereum! 👋

I've been building a web capture API that uses x402 micropayments on Base mainnet. Here's what makes it different:

**The Problem:**
Traditional web capture APIs require accounts, API keys, credit cards, and monthly subscriptions. For Web3 developers who want to pay with crypto, this creates friction.

**The Solution:**
Webcap is a pay-per-call web capture API where:
- You pay per API call with USDC on Base mainnet
- No accounts, no API keys, no subscriptions
- Every call is an HTTP 402 micropayment (x402 v2)
- Gasless payments via EIP-3009 transferWithAuthorization
- The facilitator pays the gas - you never need ETH

**What it does:**
- Screenshots: PNG/JPEG/PDF of any public URL ($0.001/call)
- Structured extraction: title, headings, paragraphs, links, markdown ($0.01/batch up to 50 URLs)
- SEO audits: link health, OG tags ($0.002/call)
- Site mapping: URLs from sitemap + 1-hop crawl ($0.002/call)
- Video capture: Scroll-capture as MP4/WebM ($0.005/call)
- Monitoring: Scheduled watches with change alerts ($0.10-$1.00 per 100 runs)

**Try it free:**
No payment needed for the preview endpoint: `GET /v1/extract/preview?url=https://example.com/`

**Live on Base mainnet:** https://webcap.fly.dev

**How payment works:**
1. Call a paid endpoint without payment → get HTTP 402 challenge
2. Sign a gasless EIP-3009 transferWithAuthorization (USDC → merchant)
3. Retry with signature → get your result

The whole flow is handled by the `@x402/axios` wrapper - one import and you're good to go.

**Why x402?**
- No middleman fees (just the on-chain transfer)
- No account management or rate limiting
- Settles on-chain (you can verify on BaseScan)
- Works with any x402 client

Would love feedback from the community! What use cases would you use this for?

**Links:**
- Live API: https://webcap.fly.dev
- OpenAPI spec: https://webcap.fly.dev/openapi.json
- x402 service descriptor: https://webcap.fly.dev/v1/x402/service