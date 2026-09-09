# Building a Web Capture API with x402 Micropayments

## Introduction

In this article, I'll walk through building a web capture API that uses x402 micropayments on Base mainnet. The result is a pay-per-call service where you can take screenshots, extract structured data, and monitor websites - all paid for with USDC on-chain micropayments.

**Live demo:** https://webcap.fly.dev

## What is x402?

x402 is a protocol that enables HTTP 402 (Payment Required) micropayments. Instead of requiring accounts, API keys, or credit cards, the server returns a 402 response with a payment challenge. The client signs a gasless EIP-3009 transferWithAuthorization and retries the request.

The key innovation is **gasless payments**: the facilitator (in this case, Coinbase's CDP) submits the on-chain transaction and pays the gas. The payer only signs an authorization - they never need ETH for gas.

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│   webcap    │────▶│  Facilitator│
│  (x402)     │     │   (API)     │     │   (CDP)     │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Base      │
                    │  Mainnet    │
                    └─────────────┘
```

1. **Client** sends a request to webcap
2. **webcap** returns HTTP 402 with a payment challenge
3. **Client** signs a gasless EIP-3009 transfer and retries
4. **webcap** forwards the signature to the **Facilitator**
5. **Facilitator** verifies the signature, checks USDC balance, and submits the on-chain transfer
6. **webcap** returns the result

## Implementation Details

### The Payment Flow

Here's the core payment logic in TypeScript:

```typescript
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

// Create the x402 client
const payer = privateKeyToAccount(process.env.PAYER_KEY as `0x${string}`);
const client = new x402Client().register('eip155:*', new ExactEvmScheme(payer));

// Wrap axios with payment handling
const api = wrapAxiosWithPayment(
  axios.create({ baseURL: 'https://webcap.fly.dev' }),
  client,
);

// Make a request - the wrapper handles 402 → sign → retry automatically
const { data, headers } = await api.post('/v1/x402/capture', { 
  url: 'https://example.com', 
  format: 'png' 
});

console.log(data.artifact.url);  // persistent public screenshot link
console.log(data.payment);       // { payer: '0x…', priceUsdcUnits: 1000 }
```

### Server-Side Challenge Generation

On the server side, when a request arrives without payment, we generate the x402 challenge:

```typescript
// Generate the 402 challenge
const challenge = {
  x402Version: 2,
  error: 'Payment required',
  resource: { url: req.url, serviceName: 'Webcap' },
  accepts: [{
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
    amount: '1000', // $0.001 in atomic units (6 decimals)
    payTo: '0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e',
    maxTimeoutSeconds: 300,
    extra: { name: 'USD Coin', version: '2' }
  }]
};

// Return 402 with challenge in header and body
return reply.code(402)
  .header('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(challenge)).toString('base64'))
  .send(challenge);
```

### Verification and Settlement

When the client retries with the `PAYMENT-SIGNATURE` header, we verify and settle:

```typescript
import { verifyPayment, settlePayment } from '@x402/fastify';

// In the route handler
if (!paymentSignature) {
  // Return 402 challenge
  return reply.code(402).send(challenge);
}

// Verify the payment signature
const verification = await verifyPayment(paymentSignature, challenge);
if (!verification.valid) {
  return reply.code(402).send({ error: 'Invalid payment' });
}

// Settle via the facilitator
const settlement = await settlePayment(paymentSignature, challenge);
if (!settlement.success) {
  return reply.code(402).send({ error: 'Settlement failed' });
}

// Payment successful - return the result
return { artifact: { ... }, payment: { payer: verification.payer, priceUsdcUnits: 1000 } };
```

## Pricing Structure

Webcap uses a simple per-call pricing model:

| Endpoint | Price | What you get |
|----------|-------|--------------|
| `POST /v1/x402/capture` | $0.001 | Screenshot (PNG/JPEG/PDF) + free OG metadata |
| `POST /v1/x402/extract` | $0.01 | Structured data (title, headings, paragraphs, links, markdown) - batch up to 50 URLs |
| `POST /v1/x402/audit` | $0.002 | SEO basics + link/OG health |
| `POST /v1/x402/map-lite` | $0.002 | Site URL list from sitemap + 1-hop crawl |
| `POST /v1/x402/video` | $0.005 | Scroll-capture as MP4/WebM |
| `POST /v1/x402/watches/topup` | $0.10-$1.00 | 100 pre-paid monitoring runs |

The key insight: **no subscriptions, no accounts, no minimums**. You pay exactly for what you use.

## Free Preview Endpoint

For developers who want to try before they buy, there's a free preview endpoint:

```
GET /v1/extract/preview?url=https://example.com/
```

This returns a bounded preview (title, top 5 headings, top 10 links, word count) without any payment. Rate-limited to 10 requests per minute per IP.

## Use Cases

1. **Website Monitoring:** Scheduled watches compare captures and fire webhooks on changes
2. **SEO Audits:** Check title, description, OG tags, and link health in one call
3. **Content Extraction:** Get clean markdown and structured data from any page
4. **Screenshot Services:** Generate social media preview images or archive content
5. **Data Collection:** Batch extract data from multiple URLs in a single payment

## Deployment

Webcap runs on Fly.io with:

- **Runtime:** Node.js 24 with Fastify
- **Database:** SQLite (better-sqlite3) for credits, watches, and artifacts
- **Browser:** Playwright with Chrome for rendering
- **Payments:** x402 with CDP facilitator on Base mainnet

The deployment is simple:

```bash
docker compose build && docker compose up -d
```

## Lessons Learned

1. **x402 adoption is growing:** More services are accepting x402 payments, making it easier for developers to integrate
2. **Free previews drive conversion:** The free preview endpoint is the best lead magnet - it demonstrates value with zero friction
3. **Batch endpoints have higher margins:** Allowing up to 50 URLs per extract call increases the value per payment
4. **Monitoring creates recurring revenue:** Scheduled watches with change detection turn one-time users into subscribers

## Conclusion

Building a web capture API with x402 micropayments demonstrates a new model for API monetization: no accounts, no subscriptions, just pay-per-call with on-chain settlement. The result is a simpler developer experience and a more transparent pricing model.

**Try it yourself:**
- Live API: https://webcap.fly.dev
- Free preview: https://webcap.fly.dev/v1/extract/preview?url=https://example.com/
- OpenAPI spec: https://webcap.fly.dev/openapi.json

What do you think about this approach to API monetization? Would you use a service like this?

---

*This article is part of a series about building Web3-native developer tools. Follow for more content about x402, micropayments, and building on Base.*