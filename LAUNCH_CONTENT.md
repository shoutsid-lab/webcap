# webcap Launch Content

## Hacker News "Show HN" Post

**Title:** Show HN: Webcap — screenshot any URL via API, pay per call with USDC

**URL:** https://nickname-trident-driveway.ngrok-free.dev

**Post body:**

Hey HN! I built webcap — a web capture API where you pay per call with USDC micropayments (x402 protocol). No accounts, no API keys, no subscriptions.

**What it does:**
- `POST /v1/x402/capture` — Screenshot any URL as PNG/JPEG/PDF ($0.001/call)
- `POST /v1/x402/extract` — Extract structured data (title, headings, links, markdown) ($0.01)
- `POST /v1/x402/video` — Scroll-capture a page as video ($0.005)
- Free preview endpoint to try it right now

**How payment works:**
Uses x402 — an HTTP 402-based payment protocol. POST without payment → get a 402 challenge → sign a gasless USDC transfer → retry with signature. No ETH needed for gas. The facilitator handles settlement.

**Why I built this:**
Screenshot APIs charge $50+/month subscriptions even if you only need a few captures. Self-hosting Puppeteer means managing servers. I wanted something simpler: call an API, pay a fraction of a cent, get your screenshot.

**Try it now:**
https://nickname-trident-driveway.ngrok-free.dev — use the "Try it now" form on the landing page to see a free preview.

Tech stack: Node.js, Playwright, SQLite, Docker. Self-hostable (MIT license). All 993 tests pass.

Would love feedback on the pricing model and API design.

---

## Reddit r/ethereum Post

**Title:** Webcap: Screenshot any URL via API — pay per call with USDC (x402 protocol)

**Post body:**

Built a web capture API that uses x402 micropayments on Base mainnet. The idea: no accounts, no API keys, no subscriptions — just HTTP + USDC.

**How it works:**
1. POST to `/v1/x402/capture` with a URL
2. Get HTTP 402 + a payment challenge
3. Sign a gasless EIP-3009 transferWithAuthorization (no ETH needed)
4. Retry with the signature → get your screenshot

**Pricing:**
- Screenshots: $0.001/call
- Data extraction: $0.01/call  
- Video capture: $0.005/call
- SEO audit: $0.002/call

**Why x402 matters:**
This is a real use case for HTTP 402 payments — the web standard that was designed for exactly this. No wrapped tokens, no login flows, just a protocol-native payment per API call.

Live demo: https://nickname-trident-driveway.ngrok-free.dev
GitHub: https://github.com/shoutsid-lab/webcap

Currently running on Docker + ngrok (zero-cost hosting). Would love feedback from the Ethereum community on the payment model.

---

## Reddit r/webdev Post

**Title:** Webcap: Screenshot any URL via API, pay per call with USDC — no accounts needed

**Post body:**

Built a web capture API for developers who need screenshots, data extraction, or page monitoring without managing infrastructure.

**The problem:** Screenshot APIs charge $50+/month subscriptions. Self-hosting Puppeteer means managing servers, dealing with memory leaks, and handling browser updates.

**The solution:** One API, pay per call, done.

| What | Price |
|------|-------|
| Screenshot (PNG/JPEG/PDF) | $0.001 |
| Extract structured data | $0.01 |
| Scroll-capture video | $0.005 |
| SEO audit | $0.002 |

**Key features:**
- No accounts or API keys required
- Batch up to 50 URLs in one extraction call
- Free preview endpoint to test before paying
- Self-hostable (MIT license, Docker ready)
- Persistent public links for screenshots

**How payment works:** Uses x402 — a micropayment protocol built on HTTP 402. Pay with USDC on Base mainnet, no ETH needed for gas.

Live demo: https://nickname-trident-driveway.ngrok-free.dev

This is ideal for:
- SEO monitoring at scale
- Competitive analysis
- Web archival
- Training data collection
- Link preview generation

Happy to answer questions about the implementation!

---

## Dev.to Article

**Title:** Building a Web Capture API with x402 Micropayments: A Technical Deep Dive

**Slug:** building-web-capture-api-x402-micropayments

**Content:**

# Building a Web Capture API with x402 Micropayments: A Technical Deep Dive

## The Problem

Every developer has faced this: you need to screenshot a URL, extract data from a webpage, or monitor a page for changes. Your options:

1. **Self-host Puppeteer/Playwright** — manage servers, deal with memory leaks, handle browser updates
2. **Use a Screenshot API** — pay $50+/month subscriptions even if you only need a few captures
3. **Build your own** — weeks of work for something that already exists

None of these scale well. Subscriptions waste money during low-usage periods. Self-hosting wastes engineering time on infrastructure.

## The Solution: Pay-Per-Call API

What if you could just make an HTTP call, pay a fraction of a cent, and get your result? No accounts. No API keys. No subscriptions.

That's what I built with [webcap](https://nickname-trident-driveway.ngrok-free.dev) — a web capture API that uses [x402](https://x402.org) micropayments.

## How x402 Works

x402 is an HTTP 402-based payment protocol. Here's the flow:

```
1. POST /v1/x402/capture with {"url": "https://example.com"}
2. Server responds: 402 Payment Required + PAYMENT-REQUIRED header
3. Decode the challenge: amount, merchant address, chain info
4. Sign a gasless EIP-3009 transferWithAuthorization
5. Retry with PAYMENT-SIGNATURE header
6. Server verifies, settles on-chain, returns result
```

No ETH needed for gas — the facilitator pays it. Your wallet signs the transfer, the facilitator submits it.

## The Tech Stack

```typescript
// Core stack
- Node.js + TypeScript
- Playwright (browser automation)
- SQLite (local data storage)
- Docker (containerization)
- ngrok (tunnel for development)
```

### Endpoints

| Endpoint | What it does | Price |
|----------|-------------|-------|
| `POST /v1/x402/capture` | Screenshot as PNG/JPEG/PDF | $0.001 |
| `POST /v1/x402/extract` | Structured JSON extraction | $0.01 |
| `POST /v1/x402/video` | Scroll-capture video | $0.005 |
| `POST /v1/x402/audit` | SEO audit | $0.002 |
| `GET /v1/extract/preview` | Free preview | Free |

### Batch Processing

The extraction endpoint supports batching up to 50 URLs in a single payment:

```bash
curl -X POST "https://api.webcap.dev/v1/x402/extract" \
  -H 'content-type: application/json' \
  -d '{"urls":["https://a.com","https://b.com"],"schema":"company name + tagline"}'
```

One payment covers the entire batch. This makes bulk data extraction extremely cost-effective.

## Why Crypto Payments for APIs?

Traditional API payments require:
1. Account creation
2. Credit card on file
3. Subscription management
4. Invoice reconciliation

x402 payments require:
1. A USDC balance
2. Sign a transaction

That's it. For developers who already have crypto, this eliminates the friction of account management. For businesses, it enables programmable payments without billing infrastructure.

## Self-Hosting

webcap is MIT licensed and fully self-hostable:

```bash
git clone https://github.com/shoutsid-lab/webcap.git
cd webcap
docker compose build && docker compose up -d
```

The Docker setup includes health checks, resource limits, and persistent data volumes.

## What's Next

1. **Stripe integration** — credit card payments for non-crypto users
2. **Webhook monitoring** — scheduled page watches with alerts
3. **Custom schemas** — define exactly what data to extract
4. **Rate limiting improvements** — higher throughput for batch operations

## Try It

Live demo: https://nickname-trident-driveway.ngrok-free.dev
GitHub: https://github.com/shoutsid-lab/webcap
npm: https://www.npmjs.com/package/webcap

---

*Built by Shoutsid Lab. Open source, MIT licensed.*
