# Wave-4 Final Gate Evidence (HEAD 816e782, 2026-09-06)

Report only — no fixes bundled, no src/test edits, no commits.

## Gate results

| Gate | Result |
|---|---|
| `npx tsc -p tsconfig.check.json` | CLEAN (exit 0) |
| `npx vitest run` (full suite) | **519 passed + 4 failed (523)** — Test Files 1 failed \| 58 passed (59) |
| `git diff -- package.json package-lock.json` | EMPTY (no new deps) |
| 402-amount surface (`x402.capture/extract/audit/watches.topup` + `x402-bazaar` + `openapi`) | **70/70 green**; live 402 amounts: capture `1000`, extract `10000`, audit `2000`, watches-topup `100000` |
| `git diff 194a4d1..HEAD -- tests/mpp/ src/mpp/` | EMPTY (no mpp file touched by wave) |

## Root-cause verdict: the 4 `tests/mpp/locks.test.ts` failures (NOT pre-existing)

- All 4 failures are the same assertion: `expect(sha256Hex(res.body)).toBe(CAPTURE_POST_SHA)` —
  `expected 'be97a7d1…' to be '1954d11f…'` (2 in surface lock (d), 2 in surface lock (f)).
- Deterministic, not environmental: `tests/mpp/locks.test.ts` alone at HEAD fails **identically twice in a row**
  (4 failed \| 14 passed, 18 total).
- Pre-existing claim is **REFUTED**: ephemeral worktree at base `194a4d1` runs the same file **18/18 green**.
- Mechanism: wave commit `bfd04d4 feat(capture): surface viewport/mobile options in schemas, challenges, prose (GREEN)`
  added `viewport/deviceScaleFactor/isMobile/userAgent` to `CAPTURE_INPUT_SCHEMA` in
  `src/server/x402/challenges.ts`, changing the `POST /v1/x402/capture` 402 challenge body that the
  `CAPTURE_POST_SHA` pin locks. Stale pin, not a behavior regression: all price-amount assertions
  (`1000`/`10000`/`2000`/`100000`) and x402 parity assertions in the same file still pass.
- Fix (NOT applied, for wave owner): update `CAPTURE_POST_SHA` in `tests/mpp/locks.test.ts` to the new
  legitimate body hash `be97a7d1…` (full hex in suite output), or re-pin via the lock suite's own procedure.

## S1–S4 scenario evidence (binary observables)

- **S1 links.sample**: paid `POST /v1/x402/audit` → 200, `audit.links.sample = [{href:"https://example.com/",text:"self"}]`,
  `every(i => typeof i.href==='string' && typeof i.text==='string')` = true, old string-shape = false,
  `payment.priceUsdcUnits` = 2000. → `s1-audit-paid.json`
- **S2 twitter/article**: `GET /og-debugger?url=` HTML contains `twitter:title`, `twitter:card`, `twitter:image`,
  `article:published_time`, `article:author`, `Jane Author` (all true). → `s2-debugger-tag-rich.html`
- **S3 score+CTA**: tag-poor → `Score 0/100` (<50), strong CTA `Fix this preview` present, WhatsApp/Discord/Slack
  hint band present; tag-rich → `95/100` (≥80), strong CTA absent, soft CTA `Need this at scale?` present;
  scorer vector deterministic (repeat identical), poor 0 / rich 94, both in 0–100.
  → `s3-debugger-tag-poor.html`, `s3-debugger-tag-rich.html`, `s3-scorer-vector.json`
- **S4 viewport+422**: default PNG **1280×720** vs mobile-viewport PNG **780×1688** (= 390×844 CSS @ DSF 2) —
  dims differ = true; invalid options `{viewport:{width:1280.5,height:800}}` → **422 + balance delta 0**.
  → `s4-viewport-default.png`, `s4-viewport-mobile.png`, `s4-viewport-dims.json`, `s4-422-envelope.json`
- **S4 contract deviation (recorded, not fixed)**: scenario contract expects `{width:100}` → 422, but
  implementation **clamps** out-of-range integers (`capture-parse.ts:39`) — probe returned **200 and charged
  1 credit** (balance 1→0). 422 applies to wrong-type/malformed options only. → `evidence-a-summary.json`
  (`s4-width100-probe`).

## Artifact paths (all under `.omo/ulw-research/20260906-192045/`)

- `s1-audit-paid.json` (1210 B) — paid audit 200 response JSON
- `s2-debugger-tag-rich.html` (15708 B) — twitter/article tag table dump
- `s3-debugger-tag-poor.html` (15211 B) — Score 0/100 + strong CTA dump
- `s3-debugger-tag-rich.html` (15715 B) — 95/100 + soft CTA dump
- `s3-scorer-vector.json` (995 B) — scorer determinism vector
- `s4-viewport-default.png` (8999 B) / `s4-viewport-mobile.png` (9559 B) — PNG pair
- `s4-viewport-dims.json` (259 B) — decoded IHDR dims + differ flag
- `s4-422-envelope.json` (141 B) — 422 envelope
- `evidence-a-summary.json` (2005 B) — all binary observables incl. 402 amounts + width:100 probe
- Runners (provenance): `evidence-a.mts`, `evidence-b.mts`
- Test ids: `tests/e2e/x402.audit.test.ts` (A1/A2), `tests/e2e/capture.test.ts` (viewport + og enrich),
  `tests/api/og-debugger.test.ts` (rows/score/hints/CTA/XSS), `tests/api/capture.invalid.test.ts` (422),
  `tests/unit/og-score.test.ts` (scorer), `tests/mpp/locks.test.ts` (pin failures)
