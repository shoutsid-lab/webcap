# Agent-first roadmap

Sequenced by one question: **what most increases settled paid calls from
autonomous agents?** Read `docs/strategy/agent-first.md` first — that charter
defines the customer and the rules; this file only sequences the work.

Evidence baseline: discovery solved, demand ~zero, 1 lifetime paid call
($0.01), 2 trial claims, 0 active watches. See the charter for the full table.

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
- [ ] **Re-register the post-cutover origin.** The MPP doc no longer names the
      retired ngrok realm, but listings key on host, so `webcap.shoutsid.fyi`
      must still be (re)asserted at 402index, x402scan, mppscan and CDP Bazaar.
      Operational, not a code change.
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
- [ ] **Sell the paid products on the prepaid rail, not just x402.** The
      credits rail (API key + credit packs + invoices) already exists and is
      funded by a normal USDC transfer, but it meters exactly one product:
      `POST /v1/capture`. Everything else — extract, audit, map-lite, video,
      analyze, batch — is x402-only, which means an agent runtime that holds a
      bearer token but no signing key cannot buy them at all. Most automated
      consumers can send a header; far fewer can sign EIP-712 per call. This is
      the cheapest remaining conversion lever: wire the existing metered path
      to the existing handlers (and decide the credit price per product, since
      packs span $0.0012–$0.005 per credit against a $0.01 extract).

## Phase 2 — Recurring agent demand

The cheapest revenue is an agent that keeps calling.

- [ ] **Watches as the recurring rail.** A watch is free to create, then needs
      credits. Make the funding step machine-completable and the webhook a
      first-class agent feed (structured event types, not just "changed").
      *Acceptance: ≥1 watch with credits > 0.
- [ ] **Batch/bulk pricing an agent can budget.** Extract already covers a batch
      per payment. Document and surface the per-URL economics as the default
      call for agents doing research, so one decision funds many calls.
- [ ] **Reliability the customer can see.** Publish uptime/latency from
      `/v1/status` at a stable, machine-readable URL so an agent operator can
      gate on it.

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
that is not derived from settled `revenue_ledger` rows. These are archived
history under `docs/archive/`.

## How to sequence anything new

1. Name the agent behaviour it changes.
2. Name the table that will show the change.
3. If neither can be named, it is not a Phase 0–3 item.
