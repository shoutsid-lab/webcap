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

- [ ] **Publish to where agents load tools.** The manifests exist
      (`/.well-known/openai-tools.json`, `/.well-known/mcp-tools.json`,
      `agent-card.json`). Being *hostable* is not being *installed*: ship an
      installable MCP server / npm package an agent operator can add in one
      line, and submit to the MCP registry and agent-tool directories.
      *Acceptance: a third-party agent runtime can wire webcap without reading
      our docs.*
- [ ] **Shorten trial → first pay.** A claimed trial currently returns a
      `paidNext` pointer; nothing drives the agent back. Add an explicit,
      machine-readable "you have used your free call; next call is
      `POST /v1/x402/...` at `$X`" in the trial receipt and in the 409 path,
      plus a prepaid **credit pack** an operator can buy once and let the agent
      spend without re-signing per call.
      *Acceptance: ≥1 wallet with a `revenue_ledger` row that previously
      appears in `trial_claims`.*
- [ ] **Make `402` impossible to misread.** Ensure every discovery surface
      agrees on method (`POST`), price, and network; see the GET-method risk
      flagged in the charter. Fix it only with spec compliance and tests.

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
