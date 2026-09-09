# webcap Data Analysis Report — Unblocking the Next Iteration

**Date:** 2026-09-09
**Data Sources:** `/v1/status`, `/v1/funnel`, `tracking_events` table
**Analysis Period:** Last 24 hours

---

## Executive Summary

The funnel data reveals a critical bottleneck: **users who successfully preview content are NOT converting to paid upgrades**. This is the primary data insight blocking the next iteration.

### Key Findings

| Metric | Value | Target | Status |
|---|---|---|---|
| Page views | 67 | 1,000/month | ⚠️ Low (pre-launch) |
| Preview tries | 12 (17.9% of page views) | 30% | ⚠️ Below target |
| Preview successes | 4 (33.3% of tries) | 90% | 🔴 Critical |
| Upgrade clicks | 0 (0% of successes) | 10% | 🔴 Critical |
| Curl copies | 0 | 5% | 🔴 Critical |
| Email subscribes | 0 | 3% | 🔴 Critical |
| Revenue | $0.034 | £1,000/month | 🔴 Pre-revenue |

---

## Data Sources Identified

### 1. Primary: `/v1/funnel` Endpoint
**Location:** `src/server/status.ts` (lines 289-460)
**Data:** Conversion funnel, hourly breakdown, referrer sources, error types
**Refresh:** Real-time from `tracking_events` SQLite table

### 2. Primary: `/v1/status` Endpoint
**Location:** `src/server/status.ts` (lines 1-282)
**Data:** Uptime, revenue totals, endpoint hit counts, watch/artifact counts
**Refresh:** Real-time

### 3. Secondary: `tracking_events` Table
**Location:** `src/db/index.ts` (schema), `src/server/routes.ts` (writes)
**Schema:** `event`, `meta_json`, `referrer`, `user_agent`, `ip_hash`, `created_at`
**Events tracked:** `landing_view`, `preview_submit`, `preview_result_success`, `preview_result_error`, `upgrade_click`, `curl_copy`, `email_subscribe`, `cta_click`

### 4. Secondary: Landing Page JavaScript
**Location:** `src/server/pages/landing.ts` (lines 348-585)
**Data:** Client-side event tracking via `navigator.sendBeacon()`
**Events:** All funnel events with metadata (url, error type, source)

---

## Critical Analysis: Why Upgrade Clicks Are Zero

### Root Cause Hypothesis

The data shows 4 successful previews but 0 upgrade clicks. This suggests one or more of:

1. **CTA visibility issue** — The upgrade CTA may not be visible/prominent enough after preview results
2. **Value perception gap** — Users don't see enough value in the preview to justify paying $0.01
3. **Friction in payment flow** — The x402 payment process may be too complex for new users
4. **No Stripe option** — Non-crypto users cannot pay (no card payment option yet)

### Evidence from Data

```
Preview successes: 4
Upgrade clicks: 0 (0% conversion)

This means: Users ARE seeing the preview results but are NOT clicking the upgrade button.
```

### Recommended Investigation

1. **A/B test CTA placement** — Move upgrade CTA above the fold in preview results
2. **Add Stripe payments** — Widen addressable market beyond crypto-native users
3. **Simplify payment flow** — Consider "pay with card" option for non-crypto users
4. **Improve preview value** — Show more truncated content to demonstrate value

---

## Critical Analysis: Preview Success Rate (33%)

### Current State

```
Preview tries: 12
Preview successes: 4 (33.3%)
Preview errors: 6 (50%)
```

### Error Breakdown

| Error Type | Count | Sample URL | Root Cause |
|---|---|---|---|
| `network_timeout` | 5 | `https://news.ycombinator.com/` | Browser capture exceeds 45s timeout |
| `capture_failed_502` | 1 | `https://this-does-not-exist-xyz123.invalid` | Invalid URL (expected) |

### Root Cause Analysis

The `network_timeout` errors (5/6 failures) indicate the browser-based capture is timing out for popular sites like Hacker News. This is likely because:

1. **HN has heavy JavaScript** — Full page render takes >45s in headless Chrome
2. **ngrok latency adds overhead** — Free tier adds ~2-5s per request
3. **Server resource constraints** — Single container may be CPU/memory limited

### Recommended Fixes

1. **Implement HTTP-only fallback** — When browser capture fails, fetch via plain HTTP + HTML parse
2. **Reduce timeout to 30s** — Faster failure = better UX
3. **Add retry logic** — Retry once on transient timeouts
4. **Cache successful previews** — Avoid re-capturing the same URL

---

## Referrer Analysis

### Current Distribution

| Referrer | Count | % of Total |
|---|---|---|
| direct | 63 | 94% |
| hacker_news | 4 | 6% |

### Insight

The 4 Hacker News referrals indicate early interest from the target audience. However, the conversion from HN traffic to preview tries is low (4 referrals → ? preview tries).

### Recommended Actions

1. **Track HN-specific conversions** — Add `utm_source=hacker_news` to HN post links
2. **Optimize for HN audience** — Technical content, working demo, clear value prop
3. **Engage HN comments** — Respond to all comments within 1 hour of posting

---

## Hourly Trend Analysis

### Last 3 Hours

```
2026-09-09T17:00:00Z  cta_click=5, landing_view=12, preview_result_error=2, preview_submit=2
2026-09-09T18:00:00Z  cta_click=6, landing_view=17, preview_result_error=1, preview_result_success=4, preview_submit=5
2026-09-09T19:00:00Z  test_ping=1
```

### Insight

- **Peak traffic hour:** 18:00 UTC (17 page views, 5 preview submits, 4 successes)
- **Preview success rate improved:** 18:00 had 80% success (4/5) vs 17:00 had 0% (0/2)
- **No upgrade clicks in either hour** — Confirms the CTA conversion problem

---

## Next Iteration Recommendations

### Priority 1: Fix Preview Success Rate (This Week)

**Goal:** Increase preview success rate from 33% to >80%

**Actions:**
1. Implement HTTP-only fallback in `src/server/routes.ts` (preview endpoint)
2. Reduce client timeout from 45s to 30s in `src/server/pages/landing.ts`
3. Add retry logic for transient network errors
4. Cache successful previews in SQLite

**Files to modify:**
- `src/server/routes.ts` — Add `previewFallback()` function
- `src/server/pages/landing.ts` — Reduce timeout, add retry
- `src/db/index.ts` — Add preview cache table

### Priority 2: Fix Upgrade CTA Conversion (Next Week)

**Goal:** Achieve >5% upgrade click rate from successful previews

**Actions:**
1. Move upgrade CTA above the fold in preview results
2. Add Stripe payment option (widens addressable market)
3. Simplify x402 payment flow explanation
4. A/B test CTA messaging ("Get Full Extract" vs "Unlock Everything")

**Files to modify:**
- `src/server/pages/landing.ts` — Redesign upgrade CTA section
- `src/server/routes.ts` — Add Stripe checkout endpoint (future)

### Priority 3: Optimize for Hacker News Launch (Ongoing)

**Goal:** Convert HN traffic to paying customers

**Actions:**
1. Add UTM tracking to HN post links
2. Create HN-specific landing page variant
3. Prepare comment engagement script
4. Monitor `/v1/status` hourly during HN traffic spike

---

## Data Pipeline Architecture

### Current State

```
Client (browser) → sendBeacon('/v1/track') → SQLite (tracking_events)
                                                    ↓
                                          /v1/funnel endpoint
                                                    ↓
                                          Marketing dashboard (manual)
```

### Recommended State

```
Client (browser) → sendBeacon('/v1/track') → SQLite (tracking_events)
                                                    ↓
                                          /v1/funnel endpoint
                                                    ↓
                                          Real-time dashboard (auto-refresh)
                                                    ↓
                                          A/B test framework
                                                    ↓
                                          Automated alerts (Slack/email)
```

### Implementation Roadmap

**Month 1:**
- Add real-time dashboard (auto-refresh every 60s)
- Implement A/B test framework for CTAs
- Set up automated alerts for critical metrics

**Month 2:**
- Add cohort analysis (users who preview → upgrade)
- Implement revenue attribution by referrer
- Build conversion optimization playbook

**Month 3:**
- Add predictive analytics (which users will convert)
- Implement automated A/B test winner selection
- Build executive dashboard for board meetings

---

## Conclusion

The data analysis reveals two critical blockers for the next iteration:

1. **Preview success rate (33%)** — Too many timeouts, needs HTTP fallback
2. **Upgrade CTA conversion (0%)** — Users see value but don't click, needs UX optimization

**Immediate actions:**
1. Fix preview endpoint reliability (HTTP fallback, retry logic)
2. Redesign upgrade CTA for better visibility
3. Add Stripe payments to widen addressable market

**Expected impact:**
- Preview success rate: 33% → 80% (+142%)
- Upgrade click rate: 0% → 5% (new revenue stream)
- Revenue: $0.034 → £100/month (within 30 days)

---

**Analysis Owner:** CTO
**Data Sources:** `/v1/status`, `/v1/funnel`, `tracking_events`
**Next Review:** 2026-09-16 (Week 1 sprint review)
