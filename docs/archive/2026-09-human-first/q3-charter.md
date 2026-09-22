# Q3 Project Charter — webcap (Shoutsid Lab)

**Period:** September–November 2026 (90 days)
**Product:** webcap — Pay-per-call web capture API
**Team:** 4 employees (CEO, CTO, Marketing Lead, [Unallocated])
**Status:** Pre-revenue, pre-launch (HN post pending)

---

## Q3 Objectives (from STRATEGY_2026_09.md)

| Objective | Target | Current | Gap |
|---|---|---|---|
| MRR | £1,000/month | £0 | −£1,000 |
| Paying customers | 100 | 0 | −100 |
| Free preview users | 1,000+ | ~0 | −1,000 |
| HN upvotes | 500+ | 0 | −500 |
| Dev.to articles | 3 | 0 | −3 |
| Stripe payments live | Yes | No | Blocked |

---

## Resource Allocation

### CTO (You) — 40 hrs/week

| Week % | Responsibility | Deliverables |
|---|---|---|
| 50% | **Platform reliability** | Server uptime >99%, ngrok stability, Docker deploys |
| 25% | **Feature development** | Stripe integration, batch extract improvements, ML pipeline |
| 15% | **Quality assurance** | Test coverage maintenance (993 tests), OpenAPI accuracy |
| 10% | **Technical documentation** | API docs, deployment guides, troubleshooting |

**Key Q3 milestones:**
- Week 1-2: Fix any post-launch technical issues (preview endpoint, ngrok)
- Week 3-4: Implement Stripe payments ( widen addressable market)
- Month 2: Batch extract optimization (50 URLs, structured output)
- Month 3: ML pipeline integration (classification, accessibility audit)

### CEO — 40 hrs/week

| Week % | Responsibility | Deliverables |
|---|---|---|
| 40% | **Business development** | Direct outreach to 20 Web3 projects, partnership deals |
| 30% | **Fundraising/Finance** | Balance management, revenue tracking, investor relations |
| 20% | **Product strategy** | Feature prioritization, competitive analysis, pricing |
| 10% | **Operations** | Admin, compliance, legal (MIT license maintenance) |

**Key Q3 milestones:**
- Week 1: Approve HN launch, monitor /v1/status hourly
- Week 2-4: Close 3+ paying customers from direct outreach
- Month 2: Secure £500+ MRR from existing pipeline
- Month 3: Prepare seed deck if metrics justify

### Marketing Lead — 40 hrs/week

| Week % | Responsibility | Deliverables |
|---|---|---|
| 50% | **Content creation** | 3 Dev.to articles, Reddit posts, Twitter threads |
| 30% | **Community management** | HN/Reddit comment engagement, Discord setup |
| 20% | **Analytics & optimization** | Funnel tracking, A/B tests, conversion optimization |

**Key Q3 milestones:**
- Week 1: Execute HN launch, Reddit r/ethereum + r/webdev posts
- Week 2: Publish first Dev.to article
- Month 2: Launch referral program (10% commission)
- Month 3: Community of 100+ developers

### [Unallocated] — 40 hrs/week

**Current assignment:** Available for:
- Customer support (scaling with user growth)
- QA/testing (manual edge cases, cross-browser)
- Content production (additional articles, tutorials)
- Sales assistance (demo calls, onboarding)

**Recommended allocation once revenue starts:**
- Month 1: 100% available (pre-revenue)
- Month 2: 50% customer support, 50% QA
- Month 3: Dependent on MRR (if >£500, assign to sales)

---

## Budget Allocation

| Category | Q3 Budget | Source | Notes |
|---|---|---|---|
| **Infrastructure** | £0 | Self-hosted (Docker + ngrok) | Zero-cost hosting strategy |
| **Marketing** | £0 | Organic channels only | HN, Reddit, Dev.to, GitHub |
| **Tools** | £0 | Open source stack | Fastify, Playwright, SQLite |
| **Paid ads** | £200 | Reserved for Month 3 | Reddit/Twitter ads to validate paid acquisition |
| **Total** | £200 | — | Bootstrap mode |

---

## Risk Register

| Risk | Impact | Probability | Mitigation | Owner |
|---|---|---|---|---|
| HN post gets buried | High | Medium | Optimal timing (Tue/Wed 10am EST), aggressive comment engagement | Marketing |
| ngrok tunnel fails under load | High | Medium | Monitor /v1/status, Docker health checks, fallback to Cloudflare | CTO |
| Zero paying customers | High | Low | Free preview as lead magnet, direct outreach to 20 Web3 projects | CEO |
| Competitor copies model | Medium | Medium | Speed of execution, community building, MIT license moat | Marketing |
| Stripe integration delays | Medium | Low | Start Week 3, parallel with feature work | CTO |
| Budget exhaustion | Low | High | Zero-cost strategy, reinvest first revenue | CEO |

---

## Dependencies & Blockers

### Current Blockers
1. **HN post not live** — Marketing task #4 (finalize content) and #8 (hold posts until quality improvements) are blocking launch
2. **Zero balance** — Cannot run paid ads until Month 3 (reserved £200)
3. **ngrok dependency** — Free tier has stability limits; need Cloudflare named tunnel for production

### External Dependencies
- **x402 facilitator** — Requires CDP API key for mainnet (production checklist item 3)
- **Stripe integration** — Blocked on development time (CTO Week 3-4)
- **Community platform** — Discord/Telegram setup deferred to Month 2

---

## Success Criteria (90-day)

### Must Have (Pass/Fail)
- [ ] £1,000 MRR achieved
- [ ] 100+ paying customers
- [ ] 1,000+ free preview users
- [ ] 3 Dev.to articles published
- [ ] Stripe payments live

### Should Have (Stretch)
- [ ] 500+ HN upvotes
- [ ] 100+ Discord members
- [ ] 20+ direct outreach responses
- [ ] £2,000+ MRR (stretch)

### Nice to Have
- [ ] 1 enterprise customer (>£100/mo)
- [ ] Conference speaking slot
- [ ] Press coverage (TechCrunch, The Block)

---

## Review Cadence

| Frequency | Meeting | Attendees | Focus |
|---|---|---|---|
| Daily | Standup | CTO + Marketing | Launch metrics, technical issues |
| Weekly | Sprint review | All 4 | Progress vs charter, blockers |
| Bi-weekly | Board check-in | CEO + CTO | Financials, strategy pivot if needed |
| Monthly | Full review | All 4 | Q3 objective tracking, resource reallocation |

---

**Charter Owner:** CTO
**Created:** 2026-09-09
**Last Updated:** 2026-09-09
**Next Review:** 2026-09-16 (Week 1 sprint review)
