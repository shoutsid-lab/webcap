# Agent-first roadmap

Sequenced by one question: **what most increases settled paid calls from
autonomous agents?** Read `docs/strategy/agent-first.md` first — that charter
defines the customer and the rules; this file only sequences the work.

Evidence baseline (refreshed 2026-09-23): discovery solved, demand ~zero, 1
lifetime paid call ($0.01), 3 trial claims, 0 active watches. See the charter
for the full table.

---

## Phase 0 — Tell the truth, then measure it (now)

The product already has excellent agent surfaces; one operational gap remains.

- [x] **Advertise MPP inside `llms.txt` and `skill.md`.** MPP is live
      (`WWW-Authenticate: Payment`, `x-payment-info`) but the two documents an
      LLM actually reads never mentioned it — an MPP-native agent read the
      x402-only story and left. *Shipped in this takeover.*
- [x] **Agent-income funnel analytics.** Shipped: `GET /v1/agent-funnel`
      (public, aggregate-only) reports reach → challenge → trial → paid →
      retention → recurring in one call, derived from `endpoint_hits` (with
      `user_agent` attribution), `trial_claims`, `revenue_ledger`, `watches`.
      Replaces the dead human path (`/v1/funnel`) as the number that matters.
      *Acceptance met: distinct paying wallets and client reach are one request
      away, no SQL.*
- [~] **Re-register the post-cutover origin.** Listings key on host, so
      `webcap.shoutsid.fyi` had to be re-asserted everywhere after the cutover.
      402index re-asserts itself (cron q6h, green 2026-09-23 06:00), x402scan
      was re-registered at cutover (origin `webcap.shoutsid.fyi`, 9 resources,
      SIWX), and mppscan is now registered for the new origin (`registered: 65,
      failed: 0`, 2026-09-23) — its audit also exposed 10 operations with no
      declared auth mode, which it silently skips; every operation now declares
      one (`apiKey`, `x-payment-info`, or explicit `security: []`), a test pins
      it, and the re-audit is clean (10 warnings → 1: the remaining
      `L2_ROUTE_COUNT_HIGH`, our 75 advertised operations).
      **Still open: CDP Bazaar.** Its index is keyed by full URL and only a
      **settled payment** adds or keeps an entry — there is no registration API,
      and the facilitator rejects self-sends (`self_send_not_allowed`), so the
      keepalive's $0.001 self-settlement can never do it. The two indexed
      entries are both the retired ngrok host (extract, mainnet, last settled
      2026-09-14; capture, **sepolia** terms, last settled 2026-09-05) and the
      30-day no-settlement rule delists them around 2026-10-14 / 2026-10-05.
      *Remaining: fund a **non-merchant** payer wallet (≥$0.001 USDC on Base) and
      settle one call at the current origin — see `artifacts/PROOF.md`.*
      *Acceptance: `logs/` shows green re-assertion for the current host.*

## Phase 1 — The first paying agent loop

Goal: one funded agent, calling unattended, more than once.

- [~] **Publish to where agents load tools.** An installable stdio MCP server
      now ships (`src/mcp/`, `npm run mcp` / the `webcap-mcp` bin), exposing all
      six paid endpoints plus five free ones as tools, auto-paying via x402 when
      a wallet key is configured. Packaging is now verified end-to-end: the
      tarball is 333 kB / 250 files (was 20 MB / 582 — a `files` whitelist),
      `npm run build` copies `dist/db/schema.sql` so `node dist/main.js` boots
      (previously the Dockerfile patched that by hand), and an installed tarball
      passes a real MCP handshake. Remaining: publish under a **scoped** name
      (unscoped `webcap` is taken on npm by an unrelated package) and register
      with the MCP registry / agent-tool directories — needs npm auth.
      *Acceptance: a third-party agent runtime can wire webcap without reading
      our docs.*
- [~] **Shorten trial → first pay.** Shipped: every free surface now hands
      over the paid path instead of dead-ending. `GET /v1/x402/trial/status`
      always returns the full priced catalog (`paid`), the x402 payment flow
      (`howToPay`, with the same scheme/network/asset/payTo the 402 challenge
      carries), a concrete `nextStep`, and the recurring watch path — the case
      that mattered most is the wallet that has burned all five trials, which
      previously got `available: []` and nothing else. The five trial receipts,
      the 409 and the 429s carry `howToPay` too. A test pins the advertised
      prices to the live 402 challenge so the two cannot drift.
      Remaining: a prepaid **credit pack** an operator can buy once and let the
      agent spend without re-signing per call.
      *Acceptance: ≥1 wallet with a `revenue_ledger` row that previously
      appears in `trial_claims`.*
- [x] **Sell document, not chrome.** The paid extract used to walk the whole
      DOM, so an agent paid $0.01 to put cookie banners, nav and footer link
      farms into its context window. Extraction is now content-aware: a
      readability-lite score picks the page's own container (trusting
      `<article>`/`<main>`/`[role=main]`, requiring volume from heuristic
      containers), chrome subtrees are skipped, `content` reports
      {source, words, truncated}, and `options.maxContentWords` sizes the output
      to a context window. The HTTP-only preview path — the free surface an
      agent reads first — got the same treatment (article/main scope, tag-level
      chrome removal) plus `content` in its response.
      *Acceptance: met — an agent can see what it is paying for and cap it.*
- [x] **Make `402` impossible to misread.** The flagged risk was real and
      already had a victim: the x402 middleware challenges GET as well as POST
      on every paid path (deliberately — indexers probe with GET), but only POST
      was registered, so a client that answered the GET challenge retried GET
      and got `405 method_not_allowed` *after* signing. `GET /v1/x402/*`
      answered a payable 402 with nothing behind it. A real agent hit this four
      times in one session and left (endpoint_hits: payer-tagged `GET
      /v1/x402/watches/topup`, all 405). No money was taken — the middleware
      cancels settlement on any response `>= 400` — but for an automated buyer
      that is indistinguishable from a broken endpoint, and a wrapper cannot
      reason its way to the right method.
      Now every paid path serves both forms from one handler: POST keeps the
      JSON body, GET takes the same parameters in the query string (numbers and
      booleans typed, arrays/objects JSON-encoded), and `exposeHeadRoute: false`
      keeps HEAD unserved because HEAD is not in the route table and would run
      unpaid. The catalog describes both forms (derived from the POST op, so the
      price cannot disagree), `skill.md` / `llms.txt` / `openapi.json` explain
      the convention, and the claim audit probes the GET form too.
      Two guards: a test that every GET-challenged path has a GET route and no
      HEAD route (verified to fail when one is reverted to POST-only), and a
      byte-check that the catalog documents every route the router serves.
      *Acceptance: met — method, price and network now agree on every surface.*
- [x] **Sell the paid products on the prepaid rail, not just x402.** Every paid
  product (extract, audit, map-lite, video, analyze, analyze/batch) is now
  buyable with a bearer token at `POST /v1/<product>` for a uniform 1 credit
  per call — nominal $0.01/credit, pack discounts below, refunded on any
  non-200 so a 422/502 never burns a credit. The x402 handlers and the credit
  routes share the same compute cores (`product-cores.ts`, `runAnalyzeOne`),
  the credit 200s derive from the x402 response schemas (`creditOf`), and the
  OpenAPI catalog + `skill.md`/`llms.txt`/`AGENT.md`/README document the rail.
  *Acceptance: a bearer-token runtime with no signing key can buy every
  product — pinned by `tests/api/credit-products.test.ts` (21 tests).*

## Phase 2 — Recurring agent demand

The cheapest revenue is an agent that keeps calling.

- [~] **Watches as the recurring rail.** Funding is now machine-completable on
  both rails: the x402 100-run pack (`POST /v1/x402/watches/topup`) plus the
  bearer-token pack (`POST /v1/watches/{id}/topup {"runs": 100}` — 10 credits
  capture, 100 extract, x402-pack parity, atomic multi-credit spend so
  concurrent top-ups can never oversell). The webhook is already a structured
  agent feed (`WatchAlert`: watchId/url/mode/diffSummary/at/artifactUrl/
  extract/summary, generic/slack/discord channels, signed delivery).
  *Remaining: ≥1 watch with credits > 0 on live — needs a funded wallet
  (owner action); the funnel's `recurring` stage will show it.*
- [ ] **Batch/bulk pricing an agent can budget.** Extract already covers a batch
      per payment. Document and surface the per-URL economics as the default
      call for agents doing research, so one decision funds many calls.
- [x] **Reliability the customer can see.** `GET /v1/status` already publishes
  uptime, 1h avg/p50 latency, error rate + 5xx breakdown, and active watches
  at a stable machine-readable URL (plus a shields.io badge at
  `GET /v1/status-badge`); verified live 2026-09-23. An operator can gate on
  `status.ok + performance.errorRate` today — no build needed.

## Phase 3 — Widen the rails

- [ ] **MPP-first agents** — treat MPP as a peer rail in every surface, not a
      footnote; the mppscan/mpp-first directory family is an independent
      addressable market.
- [ ] **Cross-chain** (Solana and others) so agents whose treasury is not on
      Base can still pay.
- [ ] **Real-time intelligence feeds** (SSE/webhook) as a product for agents
      that react, not poll.

---

## Explicitly out of scope

Human launch campaigns, HN/Reddit/Dev.to sequences, SEO-pro positioning,
landing-page conversion polish, subscriptions/seats, and any "MRR target"
that is not derived from settled `revenue_ledger` rows. The old human-first
launch apparatus was test fiction, not real history, and was deleted from the
repo — do not reintroduce it as strategy.

## How to sequence anything new

1. Name the agent behaviour it changes.
2. Name the table that will show the change.
3. If neither can be named, it is not a Phase 0–3 item.
