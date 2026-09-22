# Reddit Posts Ready for Execution

**Status:** READY TO POST IMMEDIATELY
**Date:** 2026-09-09
**Context:** CEO directive - Execute Reddit and Dev.to posts NOW. Do not wait for HN.

---

## IMPORTANT: Honest Marketing Approach

**Current Reality (from funnel data):**
- Preview success rate: 33% (4/12 successful)
- Preview errors: 6 (mostly network_timeout)
- Zero monetization so far
- 67 page views, 18 CTA clicks, 0 conversions

**Marketing Strategy:** Be honest about current state. Position as early-stage product seeking feedback. Use unique selling points (x402 payments, no accounts, low cost) without overclaiming reliability.

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

**Current status (honest):**
- Live on Base mainnet (real USDC, real money)
- Free preview endpoint available
- Some reliability issues with complex sites (working on fixes)
- Early stage — looking for feedback from the Ethereum community

**Try it:** https://nickname-trident-driveway.ngrok-free.dev
GitHub: https://github.com/shoutsid-lab/webcap

Currently running on Docker + ngrok (zero-cost hosting). Would love feedback on both the payment model and reliability.

---

## Reddit r/webdev Post

**Title:** Webcap: Screenshot any URL via API — pay per call, no accounts needed

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

**Current status (honest):**
- Live and working
- Some preview reliability issues (network_timeout errors on complex SPAs)
- Working on HTTP fallback to improve success rate
- Early stage — need community feedback

**How payment works:** Uses x402 — a micropayment protocol built on HTTP 402. Pay with USDC on Base mainnet, no ETH needed for gas.

Live demo: https://nickname-trident-driveway.ngrok-free.dev

**Ideal for:**
- SEO monitoring at scale
- Competitive analysis
- Web archival
- Training data collection
- Link preview generation

Happy to answer questions about the implementation! Looking for feedback on what's working and what's not.

---

## Dev.to Article

**Title:** Building a Web Capture API with x402 Micropayments: Early Stage Learnings

**Slug:** building-web-capture-api-x402-micropayments-early-learnings

**Content:**

# Building a Web Capture API with x402 Micropayments: Early Stage Learnings

## The Problem

Every developer has faced this: you need to screenshot a URL, extract data from a webpage, or monitor a page for changes. Your options:

1. **Self-host Puppeteer/Playwright** — manage servers, deal with memory leaks, handle browser updates
2. **Use a Screenshot API** — pay $50+/month subscriptions even if you only need a few captures
3. **Build your own** — weeks of work for something that already exists

None of these scale well. Subscriptions waste money during low-usage periods. Self-hosting wastes engineering time on infrastructure.

## The Solution: Pay-Per-Call API

What if you could just make an HTTP call, pay a fraction of a cent, and get your result? No accounts. No API keys. No subscriptions.

That's what I built with [webcap](https://nickname-trident-driveway.ngrok-free.dev) — a web capture API that uses [x402](https://x402.org) micropayments.

**The numbers:**
- **33% success rate** (currently — working on improvements)
- **993 tests passing** — comprehensive test suite
- **$0.001/call** — fraction of a cent pricing
- **Early stage** — looking for feedback

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

## Current Challenges (Honest Assessment)

**Preview Success Rate: 33%**

The current preview endpoint (`GET /v1/extract/preview`) has a 33% success rate. The main issues:
- **network_timeout** — 5 out of 6 errors are timeouts on complex SPAs (like Hacker News)
- **Browser automation overhead** — Playwright rendering takes too long for some sites
- **ngrok latency** — Free tier adds 2-5s per request

**Planned Fixes:**
1. **HTTP-only fallback** — When browser capture fails, fetch via plain HTTP + HTML parse
2. **Reduce timeout** — Faster failure = better UX
3. **Retry logic** — Retry once on transient timeouts
4. **Cache successful previews** — Avoid re-capturing the same URL

**Zero Monetization:**
- 67 page views
- 18 CTA clicks
- 0 upgrade clicks
- 0 curl copies
- 0 email subscribes

This suggests the CTA or value proposition needs work, not just reliability.

## Self-Hosting

webcap is MIT licensed and fully self-hostable:

```bash
git clone https://github.com/shoutsid-lab/webcap.git
cd webcap
docker compose build && docker compose up -d
```

The Docker setup includes health checks, resource limits, and persistent data volumes.

## What's Next

1. **Fix preview reliability** — HTTP fallback, reduce timeout
2. **Improve conversion** — Better CTA, clearer value proposition
3. **Stripe integration** — Credit card payments for non-crypto users
4. **Webhook monitoring** — Scheduled page watches with alerts

## Try It

Live demo: https://nickname-trident-driveway.ngrok-free.dev
GitHub: https://github.com/shoutsid-lab/webcap

---

*Built by Shoutsid Lab. Open source, MIT licensed. Early stage — looking for feedback.*

---

## Execution Plan

1. **Post to Reddit r/ethereum** — Focus on x402 payments and Base mainnet
2. **Post to Reddit r/webdev** — Focus on cost savings and no accounts
3. **Post to Dev.to** — Technical deep-dive with honest assessment
4. **Monitor feedback** — Use /v1/funnel to track new traffic
5. **Iterate** — Fix preview issues based on feedback

**Key Message:** "Early stage product with unique payment model (x402 USDC). Looking for feedback on both the payment flow and reliability."

**NOT claiming:** 98.4% success rate (that's not current reality)

---

**Prepared by:** Marketing Lead, Shoutsid Lab
**Date:** 2026-09-09
**Status:** READY TO EXECUTE
