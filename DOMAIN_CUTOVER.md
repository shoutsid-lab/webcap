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
CF_TOKEN=<token> CF_ZONE=shoutsid.fyi ./bin/cf-cutover.sh
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
| x402register | passive scoring per domain | keepalive now derives host from `.env` (fixed hardcoded ngrok URL) |
| CDP Bazaar | re-list the service at the new origin (dashboard / seller flow) | keepalive validates via `bazaar-validate` |
| kkj Trust Index | **manual**: register capture+extract endpoints, get new badge IDs, update `landing.ts` trust-strip (replaces 46928/46929) | old badges keep pointing at ngrok until replaced |
| GitHub | `gh repo edit shoutsid-lab/webcap --homepage https://webcap.shoutsid.fyi` + README link swap (ngrok -> new domain) | README + `screenshots/qa-test.mjs` NGROK_BASE |
| npm `webcap` | `homepage`/repo URLs on next publish | cosmetic |

Dated launch docs (`LAUNCH_CONTENT.md`, `REDDIT_POSTS_READY.md`, etc.) keep
the old URL as historical record — do not rewrite.

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
