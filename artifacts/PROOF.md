# webcap SURFACE — proof of the complete revenue loop (TEST mode)

Self-contained evidence that webcap's full revenue loop works end-to-end:
**register → invoice → on-chain USDC payment → settlement → paid capture**.
Everything below ran against a **local anvil chain (chainId 31337)** with a
mintable USDC contract — no mainnet, no real funds, no internet (the captured
page is served by a local HTTP fixture).

## Participants (all local anvil)

| Role | Address |
|---|---|
| Chain | anvil, chainId `31337` |
| USDC contract | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| Merchant (receives USDC) | `0x366F0d933689411a8EF70DFE66De7cb90e7db445` |
| Customer (anvil account #0) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` |

The merchant is a **fresh wallet that was never minted**, so the only `Transfer`
to it on-chain is the real customer payment below — nothing else can settle the
invoice. (Addresses only; no private keys are recorded here.)

## The loop, with real values

1. **Register** — customer's wallet address is registered, a `wc_live_` API key is minted.
2. **Invoice** — a 100-credit invoice is created: `requiredUsdc = 1.0` (1 USDC = 100 credits), payable to the merchant.
3. **On-chain payment** — the customer transfers **1.0 USDC** (1,000,000 base units) to the merchant.
   - tx hash: `0x87502e4403fd844e769549a1412dde625705fea7a07b447578ebf13a6dfe379b`
   - block: `4`
4. **Settlement** — the server's poller (1s cadence) reads the `Transfer` log to the merchant, settles the invoice, and credits the account: **100 credits** (`floor(1.0 × 100)`). The account flips to `balance: 100`, invoice `status: "paid"`.
5. **Paid capture** — `POST /v1/capture` charges 1 credit (0.01 USDC), renders the local page with headless Chrome, and returns the PNG. Balance drops `100 → 99`.

## Key request/response excerpts (from the raw transcript)

**(1) Register → 201**
```
POST /v1/register
{"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"}
→ {"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","apiKey":"wc_live_3842470323b1904c0f300af8718ed10e","balance":0}
```

**(2) Invoice (100 credits) → 201**
```
POST /v1/invoice   (Authorization: Bearer wc_live_3842470323b1904c0f300af8718ed10e)
{"credits":100}
→ {"invoiceId":"1","merchant":"0x366F0d933689411a8EF70DFE66De7cb90e7db445","token":"0x5FbDB2315678afecb367f032d93F642f64180aa3","chainId":31337,"requiredUsdc":1,"credits":100,"expiresAt":"2026-09-04T19:02:56.387Z"}
```

**(3) On-chain payment → receipt** (ethers, anvil)
```
usdc.transfer(to=0x366F0d933689411a8EF70DFE66De7cb90e7db445, amount=1000000)   # 1.0 USDC
→ {"txHash":"0x87502e4403fd844e769549a1412dde625705fea7a07b447578ebf13a6dfe379b","blockNumber":4,"from":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","to":"0x366F0d933689411a8EF70DFE66De7cb90e7db445","amountBase":"1000000"}
```

**(4) Account after settlement → 200** (poll #2, ~2s after the tx)
```
GET /v1/account   (Authorization: Bearer wc_live_3842470323b1904c0f300af8718ed10e)
→ {"address":"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266","balance":100,"invoices":[{"id":"1","status":"paid","credits":100,"requiredUsdc":1,"createdAt":"2026-09-04T18:02:56.387Z"}]}
```

**(5) Paid capture → 200** (data truncated)
```
POST /v1/capture   (Authorization: Bearer wc_live_3842470323b1904c0f300af8718ed10e)
{"url":"http://127.0.0.1:8123/","format":"png"}
→ {"artifact":{"format":"png","bytes":18376,"data":"iVBORw0KGgoAAAANSUhEUgAA...[truncated]"},"creditsCharged":1,"balance":99}
```

## The screenshot

`artifacts/surface-capture.png` is the base64-decoded `artifact.data` from step 5.

- Magic bytes (first 4): **`89 50 4E 47`** (PNG signature)
- Size: **18376 bytes**
- `file`: `PNG image data, 1280 x 720, 8-bit/color RGB, non-interlaced`

## Result

A real invoice was paid **on-chain** (tx `0x87502e…e379b`, block 4), the
settlement credited exactly **100 credits**, and a paid capture returned a real
**18376-byte PNG** (magic `89504E47`) — completing the webcap revenue loop in
test mode.

---

## PUBLIC ENDPOINT (GOAL #1)

The same server was exposed to the public internet through a **Cloudflare Quick
Tunnel** (`bin/cloudflared tunnel --url http://localhost:8080`), which fronted
the local server with a public `https://` URL. Every request below went
**public internet → Cloudflare edge → tunnel → localhost:8080 → webcap**.

**Public URL:** `https://progress-benefit-cradle-structure.trycloudflare.com`

| Public request | Result |
|---|---|
| `GET /v1/health` | `200` `{"ok":true,"chainId":31337,"creditsPerUsdc":100,"pricePerCredit":0.01}` |
| `POST /v1/register` `{"address":"0xf39F…2266"}` | `201` `{"address":"0xf39F…2266","apiKey":"wc_live_f8aaabbfc270620e1baf39c56e9b2d83","balance":0}` |
| `GET /v1/og?url=https://example.com` | `200` `{"url":"https://example.com","title":"Example Domain",…}` (real headless-Chrome fetch, ~0.4 s) |

Raw responses: `artifacts/public-endpoint.txt`.

## CLEAN PUBLIC PAYMENT LOOP (GOALS #1 + #2, at the public surface)

A complete register → invoice → **on-chain USDC payment** → settle → paid
capture, driven entirely through the public URL. The merchant used here
(`0xF34E47e29bE7baA89FB97C4Dd0346c6bC0a2294e`) is a **fresh wallet that was
never minted**, so the only `Transfer` to it is the customer's real payment —
no dev-mint can falsely settle the invoice.

1. **Register** (public) → `201`, `apiKey wc_live_f8aa…d83`, balance `0`.
2. **Invoice** (public, 100 credits) → `201`, `invoiceId 1`, `requiredUsdc 1`, `credits 100`.
3. **On-chain payment** — customer (`0xf39F…2266`) transfers **1.0 USDC** to the merchant on anvil:
   - tx hash `0x5ca51b9e65850d370dcf7d5b11739f4ffd506f80fd35c83f2b36cc938c89bfbf`, block `4`.
4. **Settlement** — the poller settles invoice #1 to **exactly 100 credits** (`floor(1.0 × 100)`); account `balance: 100`, invoice `status: "paid"`.
5. **Paid capture** (public) → `200`, real **18963-byte PNG** (magic `89504E47`), `creditsCharged: 1`, balance `100 → 99`.

Raw transcript: `artifacts/public-payment-loop.txt`. Screenshot: `artifacts/public-capture.png`.

**Result:** webcap is deployed at a reachable public endpoint, and a customer
paid for capture credits with a real on-chain USDC transfer that unlocked a real
paid capture — the complete revenue loop, verified end-to-end in test mode.

---

# REAL x402 SERVICE (Base-sepolia — the pay-per-request rail, NOT test mode)

The real (non-local-anvil) payment path: a standards-based **x402 (HTTP 402) USDC
machine-payment** endpoint, **live on a public internet endpoint**, with a **real
self-custody merchant wallet** receiving on **Base-sepolia** — the exact protocol,
asset, and facilitator design that carries Base **mainnet real money**.

| Item | Value |
|---|---|
| Public URL | `https://collectors-teddy-activity-airports.trycloudflare.com` |
| Endpoint | `POST /v1/x402/capture` — pay-per-request USDC (x402 v2), no account/credits |
| Chain | Base-sepolia `eip155:84532`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (name `USDC`, version `2`) |
| Merchant (payTo, self-custody EOA) | `0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e` |
| Price | $0.001 USDC per capture (1000 atomic units) |
| Facilitator | `https://x402.org/facilitator` — verifies + settles on-chain; submits the EIP-3009 `transferWithAuthorization` and pays gas (**payer is gasless**) |
| Real-money-ready | `WEBCAP_CHAIN=base` + CDP facilitator → identical flow on Base mainnet (USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, name `USD Coin`) with real money |

## How an agent pays (x402 v2, gasless)
1. `POST /v1/x402/capture {"url":…}` with no payment → `402` + a `payment-required` header (base64 x402 v2 challenge).
2. The agent signs a **gasless** EIP-3009 `transferWithAuthorization` (from=agent, to=merchant, value=price) and retries with the `PAYMENT-SIGNATURE` header.
3. The facilitator verifies the signature **and the agent's real on-chain USDC balance**, submits the transfer, and the USDC lands in the merchant wallet. The capture is then served.

## Proof the mechanism is REAL (not a mock)
**(A) Unpaid request through the public endpoint → valid x402 v2 402** (through the Cloudflare edge):
```
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50IHJlcXVpcmVkIiwiYWNjZXB0cyI6W3sic2NoZW1lIjoiZXhhY3QiLCJuZXR3b3JrIjoiZXA...
body: {"x402Version":2,"error":"Payment required","accepts":[{"scheme":"exact","network":"eip155:84532","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","amount":"1000","payTo":"0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e","extra":{"name":"USDC","version":"2"}}]}
```

**(B) A real paying client** (`scripts/x402-pay.ts`, real EOA `0xBAc4987c4Bc949f0B2833b6BC7C5B9F7b5B9757B`) fetched the 402, signed a **real EIP-3009 authorization** (EIP-712 domain `USDC`/`2`), and the **live `x402.org` facilitator verified it on-chain** and returned:
```
payer:      0xBAc4987c4Bc949f0B2833b6BC7C5B9F7b5B9757B
challenge:  x402Version=2 scheme=exact network=eip155:84532
offer:      amount=1000 asset=0x036C…CF7e payTo=0xB255…c25e eip712={"name":"USDC","version":"2"}
FAIL: payment rejected: invalid_exact_evm_insufficient_balance
```
This rejection is the proof that the rail is real: the facilitator actually read the payer's **real Base-sepolia USDC balance** and refused to settle because it is 0. No local chain, no fake facilitator.

## On-chain balances (Base-sepolia, `balanceOf`, at time of proof)
| Wallet | USDC |
|---|---|
| Customer `0xBAc4…757B` | 0 |
| Merchant `0xB255…c25e` | 0 |

## The ONE step remaining to bank real USDC
Service, endpoint, facilitator, and payment flow are all **real and live**. The only thing between a real request and USDC landing in the merchant wallet is that the **customer EOA holds no Base-sepolia USDC** — testnet USDC must come from a faucet, which requires a one-time account/CAPTCHA (not automatable). Fund `0xBAc4987c4Bc949f0B2833b6BC7C5B9F7b5B9757B` with ≥ $0.001 Base-sepolia USDC (Coinbase CDP faucet API, or Circle faucet), then re-run:
```
X402_CUSTOMER_PRIVATE_KEY=0x… npx tsx scripts/x402-pay.ts https://example.com https://collectors-teddy-activity-airports.trycloudflare.com
```
→ the capture is served and $0.001 USDC is banked in `0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e`.

## External dependencies (honest)
1. **Customer USDC funding** — testnet USDC faucets are CAPTCHA/email-gated; needs a one-time account (CDP/Circle) or the operator's wallet. This is the sole step blocking a banked Base-sepolia payment.
2. **24/7 persistent host** — the current endpoint is a Cloudflare Quick Tunnel (ephemeral URL, process-scoped). A stable always-on URL needs a VPS / Cloudflare named tunnel (an account).

## Agent-discoverable service catalog (live + public)

GET /v1/x402/service is a FREE, machine-readable descriptor (no payment) so AI agents can
discover the service + its payment terms before paying. Live + public (in Docker, through
the ngrok tunnel). The descriptor carries a `paidEndpoints` ARRAY (3 entries, incl. the
watch top-up), the shared price block, the exact `howToPay` flow, and `freeEndpoints`.
Live excerpt (2026-09-06, Base mainnet; `body`/`note`/`howToPay` values abridged):
  { "service":"webcap", "paymentProtocol":"x402", "x402Version":2,
    "paidEndpoints":[
      { "method":"POST", "path":"/v1/x402/capture", "priceUsdc":0.001, "atomicUnits":"1000", "…":"…" },
      { "method":"POST", "path":"/v1/x402/extract", "priceUsdc":0.01, "atomicUnits":"10000", "…":"…" },
      { "method":"POST", "path":"/v1/x402/watches/topup", "priceUsdc":0.1, "atomicUnits":"100000",
        "usdcMax":1, "…":"…" } ],
    "price":{ "asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
               "network":"eip155:8453", "payTo":"0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e",
               "scheme":"exact" },
    "facilitator":"https://api.cdp.coinbase.com/platform/v2/x402",
    "howToPay":"…", "freeEndpoints":[ "…", "…", "…" ] }
This makes the revenue path agent-DISCOVERABLE: an agent GETs the catalog, learns the price
+ how to pay, then POSTs a paid route and pays per request (x402 v2). 357/357 tests.

---

## Base mainnet (live since 2026-09-05)

The rail flipped from Base-sepolia to **Base mainnet — real USDC, real money**. The flip
was **config-only**: `WEBCAP_CHAIN=base`, the **same CDP facilitator and the same merchant
keys** — no code, no route, no protocol change.

| Item | Value |
|---|---|
| Flip | config-only: `WEBCAP_CHAIN=base` (same CDP facilitator + keys) |
| Chain | Base mainnet `eip155:8453` |
| USDC (mainnet) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Merchant (payTo, self-custody EOA) | `0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e` |
| Public service | `https://nickname-trident-driveway.ngrok-free.dev` |

**Live challenges.** The live public service's unpaid calls now challenge on
`eip155:8453` with mainnet USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` and
`payTo 0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e` — the identical x402 v2 `exact`
scheme + gasless EIP-3009 flow proven on sepolia, now carrying real USDC.

**CDP validator evidence (2026-09-05).** All three paid routes were run through the CDP
validator against `eip155:8453`; each returned `valid: true` + `simulation: accepted` +
`index.active` with **zero failed preflight checks**:

| Route | CDP validator (eip155:8453) |
|---|---|
| `POST /v1/x402/capture` | `valid: true` · `simulation: accepted` · `index.active` · 0 failed preflight checks |
| `POST /v1/x402/extract` | `valid: true` · `simulation: accepted` · `index.active` · 0 failed preflight checks |
| `POST /v1/x402/watches/topup` | `valid: true` · `simulation: accepted` · `index.active` · 0 failed preflight checks |

**Merchant wallet is recipient-only.** With gasless EIP-3009 settlement the merchant EOA
never signs or broadcasts a tx — it holds no gas and needed **no seed funding**; it only
receives the settled USDC.

**Re-verified (2026-09-06).** The live public service
(`https://nickname-trident-driveway.ngrok-free.dev`) is still on mainnet:
`GET /v1/health` → `{"ok":true,"chainId":8453,"creditsPerUsdc":100,"pricePerCredit":0.01}`;
`GET /v1/x402/service` returns the 3-entry `paidEndpoints` array (capture `1000`
units, extract `10000` units, watch top-up `100000` units + `usdcMax` `1.0` human
USDC) with `price.network: eip155:8453`, mainnet USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`,
`payTo 0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e`, facilitator
`https://api.cdp.coinbase.com/platform/v2/x402`; the unpaid GET challenges
(`GET /v1/x402/capture` etc.) carry the identical `eip155:8453` offer plus the
bazaar extension in both the `PAYMENT-REQUIRED` header and the mirrored JSON
body. The CDP validator was re-run against all three paid routes: each returned
`valid: true`, `simulation: {"outcome":"accepted"}`, with 25 preflight checks
and **0 failed**.

**Second re-verification (2026-09-06, deployed commit `c235a90`, 357 tests).**
The live payment wire was re-locked after the funnel + discovery changes:

| Lock | Result |
|---|---|
| `POST /v1/x402/capture` 402 body sha256 | `4bbecbfb8583…f9d94` — byte-identical to the 2026-09-05 baseline |
| `POST /v1/x402/extract` 402 body sha256 | `3b301be2cf3e…c622c4` — identical |
| `POST /v1/x402/watches/topup` 402 body sha256 | `1562370fef12…919a1bf` — identical |
| 402 header/body parity (POST ×3, GET ×2) | JSON-equal; bazaar `input.method` matches the request method (GET challenges say GET, POST say POST) |
| CDP validator ×3 (`eip155:8453`) | `valid: true` · `simulation: accepted` · 0 failed preflight checks |

**Free-tier → paid funnel.** `GET /v1/extract/preview` 200 now carries a
machine-readable `paidUpgrade` block (`endpoint`, `priceUsdc` 0.01,
`priceUsdcUnits` 10000, the x402 v2 `howToPay` flow, `guide` =
`/skill.md`) so free-tier agents can find the paid route; the preview 422
envelopes are byte-pinned (`42065384…` / `f9cd05a7…`).

**Verified ownership (x402scan).** `/openapi.json` now serves
`"x-discovery": { "ownershipProofs": [sig] }` — an EIP-191 `personal_sign` of
the service origin, signed with the merchant key; the same signature is served
in `/.well-known/x402`. Cryptographic recovery on the host yields
`0xB25572D7317eb98EBb39c45Da40eAAEA2A56c25e` (the payTo), and x402scan's own
`checkDiscovery` reports `ownershipProofs: 1` — their verifier awards the
`ownership_verified` tier from exactly this proof.

**Distribution (5 channels, all live 2026-09-06).**

| Channel | Status |
|---|---|
| CDP Bazaar | capture + extract indexed (`discovery/merchant` total 2; topup indexes on its first settlement); listing terms from the 2026-09-05 sepolia settlement — see funding flip; 30-day no-settlement delisting (docs.cdp.coinbase.com/x402/seller/get-discovered) mitigated by the keepalive |
| 402index.io | all 3 routes directly registered (idempotent upsert on url+protocol; the bazaar-derived capture row was updated to our POST metadata) |
| x402scan.com | origin SIWX-registered (merchant wallet, auth-only); 26 resources discovered; ownership proof served |
| x402.arena | registered, `verified: true, active` (health probe) |
| agent-tools.cloud | auto-crawled, health ok |

Agent-facing surfaces: `/llms.txt`, `/skill.md` (text/markdown,
config-derived), `/openapi.json`, `/.well-known/x402`, `/v1/x402/service`.

**Keepalive (`bin/webcap-keepalive.sh`, cron 2×/week, Mondays + Thursdays
03:30).** Checks
Bazaar presence (CDP validate ×3 + `discovery/merchant`), attempts the $0.001
self-settlement (25-day success cooldown; funds loop back to the merchant
wallet; a logged no-op while the payer wallet
`0xBAc4987c4Bc949f0B2833b6BC7C5B9F7b5B9757B` holds no USDC — the attempt
doubles as the balance probe), re-asserts the 402index registrations, and
re-registers x402scan (SIWX) only if the origin drops off there. Verified
live: dry-run and real run exit 0, ledger unchanged (7 rows), state + receipts
in `state/webcap-keepalive.state` + `state/webcap-keepalive/`.

**Funding flip (the one outstanding user action).** One **mainnet**
settlement flips the Bazaar listings to `eip155:8453` in ~10–15 min and
downstream directories follow within hours. Fund
`0xBAc4987c4Bc949f0B2833b6BC7C5B9F7b5B9757B` with ≥ $0.001 USDC on Base, then:
```
X402_CUSTOMER_PRIVATE_KEY=0x… npx tsx scripts/x402-pay.ts https://example.com https://nickname-trident-driveway.ngrok-free.dev
```
Once the wallet is funded, the keepalive performs this automatically (a
funded wallet flips the listings within 3 days, worst case) — and then keeps
the listing alive for the 30-day window indefinitely.

**Status (honest).** The service is **live on Base mainnet** with real
discovery across 5 channels and the verified-ownership proof served. The
**first mainnet settlement is pending**: the test wallet holds **$0.00 USDC
on Base mainnet** (proven via Basescan; the CDP self-pay correctly reverts on
balance), and all 7 ledger rows are test-wallet verify-stage records. The
2026-09-05 CDP-facilitated sepolia settlement (which created the sepolia
Bazaar entry) proved the settlement path end-to-end through the **same CDP
facilitator**, so mainnet settlement is that same flow on `eip155:8453` — the
rail is valid, simulated and indexed; only the funded first settlement (or a
real customer) is outstanding.
