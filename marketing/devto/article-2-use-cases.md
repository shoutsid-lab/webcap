# 5 Practical Use Cases for Webcap's Pay-per-Call Web Capture API

## Introduction

Webcap is a web capture API that uses x402 micropayments on Base mainnet. Instead of requiring accounts or subscriptions, you pay per API call with USDC. In this article, I'll show you 5 practical use cases and how to implement them.

**Live demo:** https://webcap.fly.dev

## Use Case 1: Website Monitoring with Change Detection

**Problem:** You need to monitor a competitor's pricing page and get notified when it changes.

**Solution:** Use webcap's scheduled watches with change detection.

```bash
# Create a watch (free)
curl -X POST https://webcap.fly.dev/v1/watches \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://competitor.com/pricing",
    "every": "1h",
    "mode": "extract",
    "webhook": "https://your-server.com/webhook"
  }'

# Top up with 100 runs ($1.00 for extract mode)
curl -X POST "https://webcap.fly.dev/v1/x402/watches/topup?watchId=<watch-id>" \
  -H 'content-type: application/json' \
  -d '{"watchId": "<watch-id>", "runs": 100}'
```

**Result:** Every hour, webcap captures the page and compares it to the previous capture. If something changes, it fires a webhook with the diff.

**Cost:** $1.00 for 100 hours of monitoring ($0.01/hour)

## Use Case 2: SEO Audits at Scale

**Problem:** You need to audit 100 pages for SEO issues (missing meta descriptions, broken links, etc.)

**Solution:** Use webcap's extract endpoint with batch processing.

```javascript
import axios from 'axios';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const payer = privateKeyToAccount(process.env.PAYER_KEY);
const client = new x402Client().register('eip155:*', new ExactEvmScheme(payer));
const api = wrapAxiosWithPayment(axios.create({ baseURL: 'https://webcap.fly.dev' }), client);

// Audit 50 URLs in a single payment
const { data } = await api.post('/v1/x402/extract', {
  urls: [
    'https://example.com/',
    'https://example.com/about',
    'https://example.com/pricing',
    // ... up to 50 URLs
  ]
});

// Process results
data.results.forEach(result => {
  if (result.status === 'ok') {
    console.log(`${result.url}: ${result.data.title}`);
    console.log(`  Headings: ${result.data.headings.length}`);
    console.log(`  Links: ${result.data.links.length}`);
    console.log(`  Word count: ${result.data.wordCount}`);
  }
});
```

**Result:** Get structured data for all 50 URLs in one API call.

**Cost:** $0.01 total ($0.0002 per URL)

## Use Case 3: Social Media Preview Image Generation

**Problem:** You need to generate Open Graph images for sharing links on social media.

**Solution:** Use webcap's capture endpoint to generate screenshots.

```python
import os
from x402 import X402Client
from x402.schemes import ExactEvmScheme
from eth_account import Account

payer = Account.from_key(os.environ["PAYER_KEY"])
client = X402Client().register("eip155:*", ExactEvmScheme(payer))

# Capture a screenshot
response = client.post(
    "https://webcap.fly.dev/v1/x402/capture",
    json={"url": "https://example.com", "format": "png"},
)

result = response.json()
screenshot_url = result["artifact"]["url"]

# Use the screenshot URL as your OG image
print(f"OG Image: {screenshot_url}")
```

**Result:** Get a persistent public URL for the screenshot that you can use in Open Graph tags.

**Cost:** $0.001 per screenshot

## Use Case 4: Content Archival and Analysis

**Problem:** You need to archive a webpage and extract its content for analysis.

**Solution:** Use webcap's extract endpoint with markdown output.

```javascript
const { data } = await api.post('/v1/x402/extract', {
  url: 'https://example.com/article'
});

// Get clean markdown content
const markdown = data.results[0].data.markdown;

// Get structured metadata
const metadata = {
  title: data.results[0].data.title,
  description: data.results[0].data.description,
  headings: data.results[0].data.headings,
  links: data.results[0].data.links,
  wordCount: data.results[0].data.wordCount
};

// Store or analyze the content
console.log(`Archived: ${metadata.title}`);
console.log(`Content length: ${markdown.length} characters`);
console.log(`Links found: ${metadata.links.length}`);
```

**Result:** Get clean, structured content that's ready for analysis or storage.

**Cost:** $0.01 per page

## Use Case 5: Competitive Intelligence Dashboard

**Problem:** You want to track multiple competitors' websites and compare changes over time.

**Solution:** Combine webcap's extract and monitoring capabilities.

```python
import requests
from datetime import datetime

# Define competitors
competitors = [
    {"name": "Competitor A", "url": "https://competitor-a.com"},
    {"name": "Competitor B", "url": "https://competitor-b.com"},
    {"name": "Competitor C", "url": "https://competitor-c.com"},
]

# Extract current data
response = requests.post(
    "https://webcap.fly.dev/v1/x402/extract",
    json={"urls": [c["url"] for c in competitors]}
)

# Process and store results
for result in response.json()["results"]:
    competitor = next(c for c in competitors if c["url"] == result["url"])
    print(f"{competitor['name']}:")
    print(f"  Title: {result['data']['title']}")
    print(f"  Last updated: {datetime.now().isoformat()}")
    print()
```

**Result:** A snapshot of all competitors' websites that you can track over time.

**Cost:** $0.01 for all 3 competitors

## Pricing Comparison

| Service | Monthly Cost | Cost per 1000 calls |
|---------|--------------|----------------------|
| Traditional Screenshot API | $50-200/month | $0.05-0.20 |
| Self-hosted Puppeteer | $20-100/month (server) | $0.02-0.10 (amortized) |
| **webcap** | **Pay per call** | **$0.001-0.01** |

The key difference: **no monthly fees, no minimums, no accounts**. You pay exactly for what you use.

## Getting Started

1. **Try the free preview:**
   ```
   GET https://webcap.fly.dev/v1/extract/preview?url=https://example.com/
   ```

2. **Check the OpenAPI spec:**
   ```
   GET https://webcap.fly.dev/openapi.json
   ```

3. **Read the documentation:**
   ```
   GET https://webcap.fly.dev/v1/x402/service
   ```

## Conclusion

Webcap's pay-per-call model with x402 micropayments makes web capture accessible without the overhead of accounts and subscriptions. Whether you need one screenshot or thousands of extractions, you pay exactly for what you use.

The combination of simple pricing, batch processing, and scheduled monitoring makes it practical for real-world use cases from competitive intelligence to content archival.

**What use cases would you add?** Let me know in the comments!

---

*This article is part of a series about building Web3-native developer tools. Follow for more content about x402, micropayments, and building on Base.*