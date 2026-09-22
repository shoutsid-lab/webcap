# webcap docs

Root-level docs stay minimal: `README.md` (product), `AGENTS.md` (working
agreement + the agent-first mandate), `AGENT.md` (agent-facing guide,
referenced by the front-door `agentGuide` label). Everything else lives here.

- `strategy/` — **start here.**
  - `agent-first.md` — the authoritative customer charter: the customer is an
    autonomous agent, the evidence, the north-star metric, and the standing
    decision rules. Supersedes every dated plan.
  - `roadmap.md` — what to build next, sequenced by paid agent calls.
  - `metrics.md` — the agent-income funnel and how to query it.
- `operations/` — runbooks: `domain-cutover.md` (ngrok → stable domain),
  `production-checklist.md` (deploy checklist).
- `protocols/` — `mpp.md` (Machine Payments Protocol support, shipped shape).
- `research/` — `ml-research-and-roadmap.md` (market + ML feature research),
  `data-analysis-2026-09-09.md` (dated funnel analysis, historical record).
- `marketing/archive-2026-09-launch/` — dated Sept-2026 launch copy drafts
  (ngrok URLs, stale metrics) as historical record — do not rewrite.
- `archive/` — superseded documents. `2026-09-human-first/` holds the old
  human-first strategy set. Read `archive/README.md`; do not resurrect.
