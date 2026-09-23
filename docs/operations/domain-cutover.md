# Domain cutover: ngrok-free.dev -> webcap.shoutsid.fyi (primary)

## Architecture after cutover

| Role | Edge | Guard |
|---|---|---|
| Primary | Cloudflare named tunnel `webcap` -> `localhost:8080` | `bin/cf-tunnel-watchdog.sh` (cron 1m + @reboot) |
| Fallback | ngrok reserved domain (old links + indexer registrations keep working) | `bin/ngrok-watchdog.sh` (already cron; now guards `WEBCAP_FALLBACK_URL`) |
| Retired | cloudflared quick tunnel (random trycloudflare URL, nothing depends on it) | remove its cron lines |

`WEBCAP_PUBLIC_BASE_URL` is the single source of truth: 402 challenges,
catalogs (`/.well-known/x402`, `/v1/x402/service`), sitemap, agent surfaces,
and ownership proofs all derive from it at runtime. Nothing in `src/` or
`tests/` pins the old domain (verified by grep).

## Step 0 — one command (needs a Cloudflare API token, once)

Create a custom token (dashboard: My Profile > API Tokens > Create Custom
Token) with **Account | Cloudflare Tunnel | Edit**, **Zone | DNS | Edit**,
**Zone | Zone | Read** for `shoutsid.fyi`, then:

```bash
WEBCAP_AI_TOKEN=<token> CF_ZONE=shoutsid.fyi ./bin/cf-cutover.sh
```

That single command does Steps 1–4 + README/GitHub automatically
(tunnel create/reuse, credentials, DNS CNAME, cron, propagation wait,
`.env` flip, rebuild/restart, 402+catalog verification, 402index/x402scan
re-registration, homepage + README + cutover commit). Dry-tested:
fails fast without a token, cleanly rejects a bad one.

Note: `shoutsid.fyi` currently returns NXDOMAIN — if the zone itself isn't
delegated yet, set the nameservers at the registrar first
(`dig NS shoutsid.fyi` must answer), or the script fails at zone lookup.

## Step 1 — named tunnel (one time, needs `cloudflared tunnel login`)

```bash
bin/cloudflared tunnel login
bin/cloudflared tunnel create webcap   # note the tunnel ID
# edit cloudflared/config.yml: credentials-file -> ~/.cloudflared/<TUNNEL_ID>.json
```

## Step 2 — cron

```bash
crontab -e
# ADD:
# * * * * * /home/shoutsid/code/webcap/bin/cf-tunnel-watchdog.sh
# @reboot /home/shoutsid/code/webcap/bin/cf-tunnel-watchdog.sh
# REMOVE (retire quick tunnel): the tunnel-watchdog.sh lines
# KEEP: ngrok-watchdog.sh lines (fallback edge)
```

## Step 3 — flip + restart + verify

```bash
# .env: WEBCAP_PUBLIC_BASE_URL=https://webcap.shoutsid.fyi
npm run build && docker compose build webcap && docker compose up -d webcap
curl -s http://localhost:8080/v1/health
curl -s https://webcap.shoutsid.fyi/v1/health
curl -s -X POST https://webcap.shoutsid.fyi/v1/x402/analyze \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/","task":"classification"}' | head -c 300
# expect HTTP 402, amount "10000", resource url on the new domain
curl -s https://webcap.shoutsid.fyi/.well-known/x402 | jq '.endpoints[].path'
curl -s https://webcap.shoutsid.fyi/openapi.json | jq '.info.title'
```

## Step 4 — re-register the new domain everywhere

Indexers key everything by domain string, so the new domain starts
unlisted. How they found the old one: registry submissions below +
ecosystem crawlers (CarbonMonitor, the402.ai bot, litebeam registry-sync,
forum-labs-trust-prober, x402-census-probe) that poll those registries, crawl
`llms.txt`/sitemaps, and probe GET-402s on paid routes.

| Surface | Action | Notes |
|---|---|---|
| 402index.io | automatic — `scripts/402index-register.ts` reads `.env` (cron q6h) | confirm in `logs/402index-reassert.log` |
| x402scan | `npx tsx scripts/x402scan-register.ts` (reads `.env`) | keepalive re-checks discovery |
| x402gle | passive — keepalive checks `x402gle.com/servers/<host>` | appears once crawled |
| x402register | passive scoring per domain | keepalive now derives host from `.env` (fixed hardcoded ngrok URL); verified 2026-09-23: ngrok 200, new host **404 (unrated)** |
| mppscan | `curl -X POST https://mppscan.com/api/register -H 'content-type: application/json' -d '{"url":"<origin>"}'` | idempotent; re-run after any **origin, price or spec** change. 2026-09-23: `registered: 65, failed: 0` for the new origin. The response is also an **audit**: routes with no declared auth mode are reported `L2_AUTH_MODE_MISSING` and skipped (`skippedUnprotected`). The first pass skipped 10 of ours; after every operation declared an auth mode the re-audit is clean (1 warning: `L2_ROUTE_COUNT_HIGH`, 75 operations). **A cached audit replays byte-identically — check for a changed warning count, not just a 200** |
| CDP Bazaar | **needs a settled payment at the new origin — there is no registration form or API call** (docs.cdp.coinbase.com/x402/seller/get-discovered) | see the note below; the keepalive's self-settlement cannot do it |
| kkj Trust Index | **nothing to submit** (verified 2026-09-23: no register/claim endpoint for new resources — `/x402/register`, `/x402/submit`, `/x402/claim` are all 404). Its `/x402/changes` feed is **sourced from the CDP Bazaar** and polled hourly, so a new host appears only after the Bazaar indexes it — the same funded-payer blocker as Step 4a. Records are keyed to the resource URL (`/x402/trust/<id>`); ours (46929 capture, 46928 extract) name the ngrok host | `landing.ts` no longer embeds those badge ids — they linked to evidence for a domain we do not serve (the markup and the `.trust-strip` CSS were removed together; see the comment in `landing.ts`). Re-add badges with the new ids once the index lists the current domain |
| GitHub | `gh repo edit shoutsid-lab/webcap --homepage https://webcap.shoutsid.fyi` + README link swap (ngrok -> new domain) | README + `screenshots/qa-test.mjs` NGROK_BASE |
| npm `webcap` | `homepage`/repo URLs on next publish | cosmetic |

### Step 4a — CDP Bazaar after a host change (why the dashboard row was wrong)

The Bazaar has no registration step: per the seller docs, "every validated
endpoint is eligible for indexing in the CDP Bazaar **after a successful settled
payment**", and "resources that go 30 days without a settlement are removed
from both the catalog and search results". Entries are keyed by the full
resource URL, so a host change starts the new origin at **zero** and leaves the
old host's entries to expire on their own clock.

The keepalive cannot fix this by itself. Its `$0.001` self-settlement is
rejected by the CDP facilitator at verify time — `self_send_not_allowed` —
because the only funded wallet is the merchant `payTo` itself. Funding that
wallet changes nothing. The fix is a **separate funded payer** (≥ $0.001 USDC on
Base; gasless):

```bash
# X402_CUSTOMER_PRIVATE_KEY must NOT be the merchant/payTo wallet
curl -s "https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=<payTo>&limit=50" | jq '.resources[].resource'
X402_CUSTOMER_PRIVATE_KEY=0x… npx tsx scripts/x402-pay.ts https://example.com https://<new-host>
# entry appears in ~10–15 min; verify with the discovery/merchant call above
```

The keepalive logs the indexed-resource count **for the current host**
(`bazaar index for <base>: N resources (networks: …)`) precisely so a host
change that silently empties the index is visible in `logs/webcap-keepalive.log`
even while `bazaar=3/3` (validation) stays green.

Dated launch docs (`docs/marketing/archive-2026-09-launch/`, e.g. `launch-content.md`,
`reddit-posts-ready.md`) keep the old URL as historical record — do not rewrite.

## Step 5 — retire quick tunnel

After 7 days green on the new domain: kill the `cloudflared tunnel --url`
process, remove `tunnel-watchdog.sh` cron lines. Keep ngrok indefinitely
(fallback + old-badge links).

## Rollback

```bash
# .env: WEBCAP_PUBLIC_BASE_URL back to the ngrok URL
docker compose up -d webcap
```
Fallback edge means old URLs never break during the cutover window.
