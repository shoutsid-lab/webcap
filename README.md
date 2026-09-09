# webcap

[![npm version](https://img.shields.io/npm/v/webcap.svg)](https://www.npmjs.com/package/webcap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-Try%20It%20Now-brightgreen)](https://nickname-trident-driveway.ngrok-free.dev)
[![API Status](https://img.shields.io/endpoint?url=https%3A%2F%2Fnickname-trident-driveway.ngrok-free.dev%2Fv1%2Fstatus-badge&label=API%20Status)](https://nickname-trident-driveway.ngrok-free.dev/v1/status)

**Screenshot any URL, extract structured data, monitor pages for changes** — all via a single HTTP API call. Pay-per-call with USDC micropayments (x402), no accounts, no API keys.

```
POST /v1/x402/capture  →  PNG/JPEG/PDF screenshot + persistent public link
POST /v1/x402/extract  →  Structured JSON (title, headings, links, markdown)
POST /v1/x402/video    →  Scroll-capture video (MP4/WebM)
POST /v1/watches       →  Scheduled monitoring with webhook alerts
```

## Features

| Endpoint | What you get | Price |
|---|---|---|
| `POST /v1/x402/capture` | Screenshot as PNG/JPEG/PDF (base64) + persistent public artifact link + OG metadata | $0.001 |
| `POST /v1/x402/extract` | Structured page data as JSON: title, description, headings, paragraphs, links, images, word count, markdown. Batch up to 50 URLs per payment. | $0.01 |
| `POST /v1/x402/audit` | SEO basics + link/OG health in one call | $0.002 |
| `POST /v1/x402/map-lite` | Site URL list from sitemap/robots + 1-hop crawl (up to 50 URLs) | $0.002 |
| `POST /v1/x402/video` | Scroll-capture a page as MP4/WebM video | $0.005 |
| `POST /v1/watches` | Create a scheduled monitor (free to create, prepay 100-run packs) | $0.10–$1.00/pack |

### Free endpoints (no payment)

| Endpoint | Description |
|---|---|
| `GET /v1/extract/preview?url=...` | Bounded preview: title, headings, links, word count (10 req/min/IP) |
| `GET /v1/og?url=...` | Open Graph link-preview metadata |
| `POST /v1/watches` | Create a scheduled monitor (free; prepay via top-up) |
| `GET /v1/health` | Liveness check |

## Quick start

### Capture a screenshot

```bash
# 1. POST without payment → HTTP 402 + a PAYMENT-REQUIRED header
curl -si -X POST "https://nickname-trident-driveway.ngrok-free.dev/v1/x402/capture" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/"}'

# 2. Decode the base64 challenge → sign a gasless EIP-3009 transfer → retry with PAYMENT-SIGNATURE
```

### JavaScript (with x402 auto-payment)

```js
import axios from 'axios';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

// Needs USDC on Base mainnet (no ETH needed — facilitator pays gas)
const payer = privateKeyToAccount(process.env.PAYER_KEY);
const client = new x402Client().register('eip155:*', new ExactEvmScheme(payer));
const api = wrapAxiosWithPayment(
  axios.create({ baseURL: 'https://nickname-trident-driveway.ngrok-free.dev' }),
  client,
);

// Capture a screenshot (auto: unpaid → 402 → sign → retry)
const { data } = await api.post('/v1/x402/capture', { url: 'https://example.com', format: 'png' });
console.log(data.artifact.url);  // persistent public screenshot link
```

### Python

```python
import os
from x402 import X402Client
from x402.schemes import ExactEvmScheme
from eth_account import Account

payer = Account.from_key(os.environ["PAYER_KEY"])
client = X402Client().register("eip155:*", ExactEvmScheme(payer))

response = client.post(
    "https://nickname-trident-driveway.ngrok-free.dev/v1/x402/capture",
    json={"url": "https://example.com", "format": "png"},
)
print(response.json()["artifact"]["url"])  # persistent public screenshot link
```

### Extract structured data

```bash
# Single URL
curl -s -X POST "https://nickname-trident-driveway.ngrok-free.dev/v1/x402/extract" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'

# Batch (up to 50 URLs, one payment covers the whole batch)
curl -s -X POST "https://nickname-trident-driveway.ngrok-free.dev/v1/x402/extract" \
  -H 'content-type: application/json' \
  -d '{"urls":["https://a.com","https://b.com"],"schema":"company name + tagline"}'
```

## How payment works

webcap uses **x402 v2** — a gasless, accountless payment protocol built on HTTP 402:

1. **POST** a paid route with no payment → **HTTP 402** + a `PAYMENT-REQUIRED` header carrying a base64 x402 v2 challenge.
2. **Read** the challenge: USDC amount, merchant address, chain info.
3. **Sign** a gasless EIP-3009 `transferWithAuthorization` (from your wallet, to the merchant, for the amount). No ETH needed — the facilitator submits the tx and pays gas.
4. **Retry** the same request with the signed payload in the `PAYMENT-SIGNATURE` header. The facilitator verifies your USDC balance, settles on-chain, and returns the result.

No accounts. No API keys. No credits. Just HTTP + USDC.

## Self-hosting

```bash
# Clone the repo
git clone https://github.com/shoutsid-lab/webcap.git
cd webcap

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your settings

# Build and run
npm run build
npm start
```

### Docker

```bash
docker compose build
docker compose up -d
```

The Docker setup includes health checks, resource limits, and persistent data volumes. See `docker-compose.yml` for details.

### Local development (Anvil testnet)

```bash
npm install
npm run chain:up    # Starts Anvil with mintable USDC

WEBCAP_CHAIN=local \
WEBCAP_USDC_ADDRESS=$(jq -r .usdcContract /tmp/webcap-chain.json) \
WEBCAP_MERCHANT_ADDRESS=$(jq -r .merchant.address /tmp/webcap-chain.json) \
npm start
```

## Configuration

All environment variables are documented in [`.env.example`](.env.example). Key ones:

| Variable | Description | Default |
|---|---|---|
| `WEBCAP_CHAIN` | Network: `base`, `base-sepolia`, or `local` | `base-sepolia` |
| `WEBCAP_PUBLIC_BASE_URL` | Public URL for artifact links | *required* |
| `WEBCAP_X402_PRICE_USDC` | Price per screenshot in USDC | `0.001` |
| `WEBCAP_X402_EXTRACT_PRICE_USDC` | Price per extraction in USDC | `0.01` |
| `X402_FACILITATOR_URL` | Payment facilitator endpoint | `https://x402.org/facilitator` |

## API reference

Full OpenAPI 3.1 spec: [`GET /openapi.json`](https://nickname-trident-driveway.ngrok-free.dev/openapi.json)

Agent discovery: `GET /.well-known/x402`, `GET /v1/x402/service`, `GET /llms.txt`, `GET /skill.md`

## Tests

```bash
npm test           # 357 tests (46 files)
npm run typecheck  # Type checking
```

## License

MIT — see [LICENSE](LICENSE) for details.

## Links

- **Live API**: https://nickname-trident-driveway.ngrok-free.dev
- **GitHub**: https://github.com/shoutsid-lab/webcap
- **npm**: https://www.npmjs.com/package/webcap
- **OpenAPI docs**: https://nickname-trident-driveway.ngrok-free.dev/openapi.json
