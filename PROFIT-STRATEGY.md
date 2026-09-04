# Model Profit Strategy — outrunning the TPU v5e-8 cost floor

**Goal:** make a profit that outpaces the cost of running the models.
**Cost floor** (TPU v5e-8, 8 chips, 24/7, from the user's table): spot **$1,750/mo**
(≈$2.40–3.60/hr) → on-demand **$7,000/mo** (≈$9.60/hr). ≈ $21K–$84K/yr.
**Target:** revenue 2–5× the *spot* floor for a real, sustainable margin.

## The core insight
You pay a fixed floor for the silicon whether it is busy or idle. Selling the model's raw
output **per-token** competes on commodity price, and the floor eats the margin — the market
data confirms this is the *worst* game in the space (see break-even math below). The profit is in
**decoupling revenue from the compute meter**: sell the *value* the compute produces (structured
meaning, outcomes, expertise, automation) where value ≫ compute cost, **monetize the
already-paid idle cycles**, and **cut the floor** via provisioning. **Price on value, never on
tokens.**

## Break-even math for the v5e-8 (why token resale is dead)
Raw per-token resale break-even ≈ (monthly cost ÷ 730 h) ÷ (price per M) tokens, per day:
- $1,750/mo ($2.92/hr) @ $1/M blended → **~70M tokens/day**
- $7,000/mo ($11.67/hr) @ $1/M → **~280M tokens/day**

And that is only **~20–26% gross margin** at list price (break-even utilization ≈ 67%; at 40%
utilization you are at −67%). Commodity open-weight tokens show a **6–9× price spread** on
identical weights (e.g. Llama 70B: Groq $0.59/$0.79 vs Together $0.88/$0.88 per M in/out) — a race
to the bottom. A pure reseller (OpenRouter) makes **5.5%**.
**Verdict: do not sell raw tokens.**

Batch structured-output break-even — the *right* shape for v5e (async, no latency SLO):
- A page ≈ 1,500 tokens; a batch LLM pass costs **~$0.001–$0.003**.
- Sell **$0.03/page** (commodity) → break-even ~58K–233K pages/mo (hard).
- Sell **$0.50/page** (extracted *meaning* — the Docugami/Harvey umbrella) → break-even
  **~3.5K–14K pages/mo** (very reachable). **The ~10× price is the profit.**

## Ranked strategies (grounded in 2024–26 public pricing)
| # | Play | Real price | Break-even (v5e-8) | Margin | Moat |
|---|---|---|---|---|---|
| 1 | **Provisioning arbitrage** (spot/DWS/commit) | −$5,250 cost | instant | **+$4,000–5,250/mo** | — |
| 2 | **Batch structured-output engine** (v5e's native shape) | $0.03–$0.50/page | 3.5K–14K pages/mo @ $0.50 | 70–97% | med |
| 3 | **Outcome/vertical price on top** (sell meaning, not pages) | $0.99–$1.50/resolution; $1,200–$2,400/seat (legal) | a few seats / a few enterprise ACVs | >95% | high |
| 4 | **Scheduled ingestion / monitoring** (recurring; fills the always-on TPU) | $10–$100/mo/asset | ~100–500 subscriptions | high | med |
| 5 | **Fine-tune-as-a-service** (bundled, not per-token) | $30K–$500K/project (compute = 5–15% of bill) | 1–2 projects/mo | high | med–high |
| 6 | **Agent-as-a-service** (sell the labor) | $150–$450/meeting; $3,750/mo per "digital worker" | 10–50 meetings/mo | high | med |
| 7 | **Data substrate** (cheap inference under someone's expert data product) | platform / per-record | varies | med | low–med |

### The market proof (who is clearing six figures on thin compute)
- **Legal SaaS (Harvey):** $1,200–$2,400/seat/mo, median ACV ~$175K/yr, priced at **5–7% of
  associate labor cost** (the labor-substitution anchor). Undercutting 10× ($100–200/seat, where
  AmLaw volume deals actually land) still clears a $7K compute box 2–7×.
- **Support agents (Sierra, Fin, Decagon, Ada):** $0.99–$1.50/resolution (Fin $0.99, Sierra
  ~$1.50) **plus a $30K–$150K/yr platform floor**; Decagon median ACV **$432K/yr**. Outcome
  pricing *rewards* owned hardware: a higher resolution rate = more revenue **and** less compute.
- **Batch docs (Textract, LlamaParse, Unstructured, Docugami):** $0.0015–$0.50/page. Docugami
  charges **$0.50–$0.67/page for contract *meaning*** where the LLM pass costs pennies — the buyer
  pays for extracted structure, not tokens. Textract Forms ($0.05/page) is the incumbent umbrella.
- **AI SDR (11x, Artisan, Ai):** $3,750–$5,333/mo per "digital worker"; $150–$450 per qualified
  meeting (human appointment-setting benchmark $300–$600; in-house SDR $821–$1,150/meeting).
- **Fine-tune (Together, Fireworks):** 2–9× the compute at the per-token API layer; **10–50×**
  when bundled into a $30K–$500K data+eval+MLOps project (compute is 5–15% of the bill).
- **Synthetic/expert data (Scale, Surge, Arena):** $10–$100/sample, $93K–$400K contracts, Arena
  $100M ARR — but the moat is the **expert workforce**, not compute. We cannot replicate that; we
  can be the cheap inference *substrate* underneath someone else's data product.

## The decisive plan
1. **Now (free margin):** run spot + DWS; commit only the stable baseline. Floor $7,000 →
   ~$2,000. Handle preemption with checkpoint/resume. *(+ $4–5K/mo before selling anything.)*
2. **The product (v5e's native shape):** a **batch structured-output engine** — async
   capture → extract → structured JSON, priced per unit of *meaning* ($0.03–$0.50/page, and
   $0.99–$5 per verified/structured result). Break-even ~3.5K–14K pages/mo. Extends the webcap
   capture pipeline into extraction + structuring.
3. **The value layer (the "outpace" engine):** wrap the output in an **outcome/vertical price** —
   sell the verified record / the structured insight / the domain tool, not the raw page. This is
   where 10–100× the commodity price lives (the Docugami/Harvey/Sierra umbrella).
4. **The recurring engine:** **scheduled ingestion/monitoring** (continuous capture + extract +
   alert) as subscriptions — fills the always-on TPU and is sticky (the customer's schema =
   switching cost).
5. **The bet (highest ceiling):** one **vertical** (legal/clinical/finance) or an
   **outcome-priced agent** (Sierra/Fin model) — $50K–$430K ACVs where compute is a rounding error.

**North star:** $5K–$35K/mo (3–5× the spot floor). The batch engine + value layer + recurring
subscriptions get there on low volume; the vertical/agent bet scales it. **Never** raw token
resale.
