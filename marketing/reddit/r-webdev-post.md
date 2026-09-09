# Reddit r/webdev Post

**Title:** Show r/webdev: Webcap - Web capture API with pay-per-call pricing (no accounts, free preview)

**Body:**

Hey r/webdev! 👋

I've been working on a web capture API that I think might be useful for some of your projects.

**The Problem:**
Need to capture a website screenshot or extract structured data? Most APIs require:
- Creating an account
- Getting API keys
- Monthly subscriptions or credit packs
- Managing rate limits

**The Solution:**
Webcap is a pay-per-call web capture API where you just pay per API call. No accounts, no API keys, no subscriptions.

**What it does:**
- **Screenshots:** PNG/JPEG/PDF of any public URL ($0.001/call)
- **Structured extraction:** Get title, headings, paragraphs, links, images, word count, and clean markdown ($0.01 for up to 50 URLs)
- **SEO audits:** Check title, description, OG tags, and link health ($0.002/call)
- **Site mapping:** Get URLs from sitemap + 1-hop crawl ($0.002/call)
- **Video capture:** Scroll-capture a page as MP4/WebM ($0.005/call)
- **Monitoring:** Scheduled watches with change detection and webhooks ($0.10-$1.00 per 100 runs)

**Try it free (no payment needed):**
```
GET https://webcap.fly.dev/v1/extract/preview?url=https://example.com/
```
This returns a bounded preview (title, top 5 headings, top 10 links, word count) without any payment. Rate-limited to 10/min.

**How it works:**
The API uses HTTP 402 (Payment Required) with USDC micropayments on Base mainnet. You don't need to understand crypto to use it - the `@x402/axios` wrapper handles the whole flow:

```javascript
import axios from 'axios';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const payer = privateKeyToAccount(process.env.PAYER_KEY);
const client = new x402Client().register('eip155:*', new ExactEvmScheme(payer));
const api = wrapAxiosWithPayment(axios.create({ baseURL: 'https://webcap.fly.dev' }), client);

// Capture a screenshot - the wrapper handles 402 → sign → retry automatically
const { data } = await api.post('/v1/x402/capture', { url: 'https://example.com' });
console.log(data.artifact.url); // persistent public screenshot link
```

**Use cases I've seen:**
- Website monitoring and change detection
- SEO audits and competitor analysis
- Generating social media preview images
- Archiving web content
- Building scraping tools without managing infrastructure

**Live on Base mainnet:** https://webcap.fly.dev

**Pricing is transparent:**
- Screenshot: $0.001
- Extract (up to 50 URLs): $0.01
- SEO audit: $0.002
- Site map: $0.002
- Video capture: $0.005
- Monitoring packs: $0.10-$1.00 per 100 runs

**Links:**
- Live API: https://webcap.fly.dev
- OpenAPI spec: https://webcap.fly.dev/openapi.json
- Try the preview: https://webcap.fly.dev/v1/extract/preview?url=https://example.com/

Would love to hear what you think! What use cases would you use this for?