# webcap Market Research & Feature Roadmap

## Executive Summary

This document captures the market research, competitive landscape analysis, ML/AI feature research, and feature roadmap for webcap (the pay-per-call web capture API). The research was conducted to identify high-value feature expansions that leverage the existing x402 protocol infrastructure and integrate learnings from related projects (freebuff, resonance, intelligent-compact, observatory).

**Key finding:** The x402 ecosystem has reached **75.41M transactions** and **$24.24M volume** in the last 30 days (as of Sept 2026), with **105,348 endpoints indexed** and **37,457 payment-verified**. webcap is well-positioned as a foundational "eyes and ears" service for AI agents — but the window for differentiation is narrowing as the ecosystem matures. The highest-ROI path forward is **ML-enhanced intelligence features** that convert raw page data into actionable insights, not just raw captures.

---

## Market Landscape

### x402 Protocol Ecosystem (2026)

| Metric | Value | Source |
|---|---|---|
| Endpoints indexed | 105,348 | 402index.io (Sept 2026) |
| x402 verified endpoints | 36,731 (35%) | 402index.io |
| Payment-verified endpoints | 37,457 | 402index.io |
| L402 (Lightning) verified | 192 / 1,371 (14%) | 402index.io |
| MPP (Stripe/Tempo) verified | 534 / 1,431 (37%) | 402index.io |
| Healthy endpoints | 37,639 | 402index.io (last checked: 2026-09-07) |
| Degraded endpoints | 26,078 | 402index.io |
| Down endpoints | 17,889 | 402index.io |
| Unknown endpoints | 23,742 | 402index.io |
| Providers indexed | 3,533 | 402index.io |
| Providers verified | 2,192 | 402index.io |

**x402 Foundation Metrics (Last 30 Days):**

| Metric | Value |
|---|---|
| Transactions | 75.41M |
| Volume | $24.24M |
| Buyers | 94,06K |
| Sellers | 22K |

**Key Discovery Channels:**
- **402index.io** — Primary paid API directory; hourly polling; registration via url+protocol upsert; MCP server available (`@402index/mcp-server`)
- **CDP Bazaar** — Coinbase developer platform; settlement-triggered indexing; 30-day delisting window
- **x402scan.com** — Ecosystem explorer; origin registration via facilitator header probes
- **x402.org** — Linux Foundation site; docs, members, blog, reports
- **agent-tools.cloud** — Auto-crawl of public URLs
- **mppscan.com** — Dual-protocol (x402 + MPP) registration; MPP WWW-Authenticate headers
- **x402gle.com** — Server-side audition (real paid calls, AI-scored, auto-listing on pass)
- **stablecoin.com/402/** — Manual directory listing

**x402 Protocol Evolution:**
- Now a **Linux Foundation project** (announced May 2026)
- Supports **EVM (Base, Solana, AVM)** chains
- Extensions ecosystem: Bazaar (discovery), Builder Code (ERC-8021), Payment-Identifier (idempotency), SIWX, Signed Offers & Receipts, EIP-2612/ERC-20 Gas Sponsoring
- SDKs available for Express, Next.js, Hono, Fastify, Go (Gin/Echo), FastAPI, Flask
- Zero protocol fees — only nominal payment network fees

### Pricing Reference (from 402index unit economics)

| Route | Price (USDC) | Margin |
|---|---|---|
| capture | $0.001 (1000 units) | ~80% after compute cost |
| extract | $0.01 (10000 units) | ~98% on deterministic |
| audit | $0.002 (2000 units) | ~90% |
| map-lite | $0.002 (2000 units) | ~90% |
| video | $0.005 (5000 units) | 5x capture |
| watch top-up (capture) | $0.10 (100 runs) | ~80% |
| watch top-up (extract) | $1.00 (1000 runs) | ~98% |

**Unit Economics:**
- Capture: $0.001 revenue - $0.0002 amortized compute = $0.0008 net margin
- Extract: $0.01 revenue - variable model compute (unknown until MODEL_* configured)
- Watch top-up: Recurring rail (100-run packs)

### Competitive Landscape Analysis

#### Direct Competitors (x402 Web Capture/Extract)

| Competitor | Protocol | Features | Pricing | Advantage |
|---|---|---|---|---|
| **webcap** | x402 + MPP | Screenshot, extract, audit, map-lite, video, watch, AI summaries | $0.001-$0.01 | Gasless payments, persistent artifacts, batch economics, watch AI |
| **scrapfly.io** | Traditional API | Screenshot, scrape, extract | $0.002-$0.02 | JS rendering, proxy rotation, SERP API |
| **browserless.io** | Traditional API | Screenshot, PDF, scrape | $0.003-$0.01 | Headless Chrome, function-as-a-service |
| **screenshotapi.net** | Traditional API | Screenshot, PDF | $0.002-$0.005 | Simple API, thumbnails |
| **microlink.io** | Traditional API | Screenshot, extract, OG | $0.001-$0.01 | Meta information, PDF generation |

#### Adjacent Competitors (AI-Powered Web Intelligence)

| Competitor | Category | Features | Gap webcap Can Fill |
|---|---|---|---|
| **Firecrawl** | AI web scraping | Crawl, extract, structured data | No x402, no watch/monitoring, no video |
| **Crawl4AI** | Open-source crawler | Markdown extraction, LLM-friendly output | No payment infrastructure, no artifacts |
| **Jina Reader** | URL-to-markdown | Clean markdown, meta tags | No batch, no video, no monitoring |
| **Diffbot** | Web intelligence | Article extraction, knowledge graph | Expensive, no micropayment, enterprise-only |
| **Apify** | Scraping marketplace | Actor marketplace, proxy pool | Complex pricing, no x402 |

#### Competitive Positioning

webcap's unique strengths:
- **Gasless payments**: EIP-3009 transferWithAuthorization; payer signs, facilitator settles + pays gas
- **No accounts/API keys**: Pure x402 v2 exact scheme; USDC balance check only
- **Persistent artifacts**: Public links with OG metadata via `artifact.url + "/page"`
- **Batch economics**: Single flat price covers up to 50 URLs (extract); margin floor at 200 units/URL
- **Strong unit economics**: $0.001 capture at market floor price
- **Agent-native discovery**: `/llms.txt`, `/skill.md`, `/.well-known/x402`, agent card, Bazaar extension
- **Watch + AI summaries**: Scheduled monitoring with change detection and AI-generated insights
- **Multi-format output**: PNG/JPEG/PDF screenshots, structured JSON, video scroll-captures
- **Dual-protocol**: x402 + MPP compatibility

Gaps/opportunities:
- Model-enhanced extraction not first-class in free tier (partially addressed)
- No competitive SEO intelligence in audit endpoint
- Watch runs lack advanced AI capabilities (multi-turn, trend detection)
- Batch extract fails entirely when model unavailable (partially addressed with fallback)
- No webhook-based real-time intelligence feeds
- No visual similarity / screenshot comparison features
- No accessibility analysis features
- No structured data validation (JSON-LD, microdata)

---

## ML/AI Feature Research

### 1. Intelligent Page Understanding

**Current state:** webcap extracts DOM structure (title, headings, paragraphs, links, images) via `extractStructureFromDom()` in `src/capture/pipeline.ts` and optionally enriches with model extraction via `src/extract/model.ts`.

**Research direction:** Move beyond DOM parsing to **semantic understanding** of page content.

#### 1.1 Content Classification & Tagging

**Concept:** Automatically classify page content into categories (article, product, documentation, landing page, forum post, etc.) and extract semantic tags.

**Implementation approach:**
- Use the existing model extraction pipeline (`modelExtract`) with a classification prompt
- Add a `classification` field to the extract response
- Cache classifications by URL hash for repeated extractions

**Value proposition:**
- Enables smarter watch change detection (classify changes by type)
- Powers content-aware monitoring (different thresholds for different page types)
- Creates training data for future model improvements

**Estimated effort:** Low-Medium (extend existing model pipeline)
**Revenue impact:** Medium (premium classification tier at $0.005/extraction)

#### 1.2 Entity Extraction & Knowledge Graph

**Concept:** Extract named entities (people, organizations, products, locations, dates) and build a lightweight knowledge graph from page content.

**Implementation approach:**
- LLM-based entity extraction with structured JSON output
- Entity linking across batch extractions (same entity across multiple URLs)
- Optional entity graph export (JSON-LD format)

**Value proposition:**
- Powers "extract all companies mentioned on this page" type queries
- Enables cross-page entity correlation in batch extract
- Creates rich structured data for agent consumption

**Estimated effort:** Medium (new extraction schema + entity resolution)
**Revenue impact:** High (premium entity extraction tier at $0.02/extraction)

#### 1.3 Sentiment & Tone Analysis

**Concept:** Analyze page content for sentiment (positive/negative/neutral), tone (formal/informal/technical), and readability level.

**Implementation approach:**
- Model-based analysis with structured output
- Readability scoring (Flesch-Kincaid, Coleman-Liau)
- Batch comparison across multiple pages

**Value proposition:**
- Enables brand monitoring (sentiment changes over time)
- Powers content quality assessment
- Differentiates from pure extraction services

**Estimated effort:** Low (extend model extraction with new schemas)
**Revenue impact:** Medium (premium analytics tier)

### 2. Visual Intelligence

**Current state:** webcap captures screenshots (PNG/JPEG/PDF) and videos (MP4/WebM) via `src/capture/pipeline.ts` and `src/capture/video.ts`.

**Research direction:** Add ML-powered visual analysis capabilities.

#### 2.1 Screenshot Comparison & Diff

**Concept:** Compare two screenshots of the same URL over time and quantify visual changes (pixel-level diff, layout shift detection, element movement).

**Implementation approach:**
- Pixel diff using canvas-based comparison (server-side or client-side)
- Layout shift detection via element position tracking
- Visual similarity scoring (SSIM or perceptual hash)

**Value proposition:**
- Powers visual change detection in watches (beyond content diff)
- Enables "detect any visual change" monitoring
- Creates visual regression testing capabilities

**Estimated effort:** Medium (new comparison endpoint + storage)
**Revenue impact:** High (premium visual monitoring at $0.01/comparison)

#### 2.2 Accessibility Analysis

**Concept:** Analyze screenshots and DOM structure for accessibility issues (contrast ratios, alt text presence, heading hierarchy, ARIA attributes).

**Implementation approach:**
- DOM-based analysis using existing `extractStructureFromDom()`
- Contrast ratio calculation from screenshot pixel data
- WCAG compliance scoring

**Value proposition:**
- Enables automated accessibility auditing
- Powers compliance monitoring
- Differentiates from pure extraction services

**Estimated effort:** Medium (new analysis module + scoring)
**Revenue impact:** Medium (premium accessibility tier at $0.005/analysis)

#### 2.3 Layout & Design Analysis

**Concept:** Analyze page layout, visual hierarchy, and design patterns using computer vision.

**Implementation approach:**
- Element detection and classification from screenshots
- Visual hierarchy analysis (size, color, position)
- Design pattern recognition (card layout, grid, hero section)

**Value proposition:**
- Powers design trend analysis
- Enables competitive design benchmarking
- Creates training data for design AI models

**Estimated effort:** High (requires ML model training or pre-trained vision models)
**Revenue impact:** Medium (premium design analytics tier)

### 3. Predictive & Trend Intelligence

**Current state:** webcap watches track changes over time with AI summaries (`src/extract/modelSummarize.ts`) and change detection (`src/watch/scheduler.ts`).

**Research direction:** Add predictive capabilities and trend analysis.

#### 3.1 Change Prediction

**Concept:** Predict when a page is likely to change based on historical patterns (time-of-day, day-of-week, event-driven).

**Implementation approach:**
- Analyze historical watch run timestamps and change patterns
- Build simple time-series models for change frequency
- Predict next change window with confidence intervals

**Value proposition:**
- Optimizes watch scheduling (run more often before predicted changes)
- Reduces unnecessary runs (skip when no change expected)
- Creates predictive intelligence features

**Estimated effort:** Medium (historical analysis + simple ML model)
**Revenue impact:** Medium (premium predictive scheduling)

#### 3.2 Trend Detection Across Runs

**Concept:** Detect trends in watch run data (increasing/decreasing metrics, emerging patterns, anomaly detection).

**Implementation approach:**
- Time-series analysis of extracted metrics across runs
- Anomaly detection using statistical methods or simple ML
- Trend visualization and alerting

**Value proposition:**
- Enables "detect when price changes trend upward" type queries
- Powers business intelligence from web monitoring
- Creates rich analytics dashboards

**Estimated effort:** Medium-High (time-series storage + analysis)
**Revenue impact:** High (premium trend analytics tier)

#### 3.3 Competitive Monitoring

**Concept:** Monitor competitor pages and detect strategic changes (new products, pricing changes, content updates).

**Implementation approach:**
- Batch extract with entity/product extraction
- Change classification by type (content, pricing, structural)
- Competitive intelligence reports

**Value proposition:**
- Enables automated competitive intelligence
- Powers market research automation
- Creates premium monitoring capabilities

**Estimated effort:** Medium (extend existing watch + batch extract)
**Revenue impact:** High (premium competitive intelligence tier)

### 4. Agent-Native Intelligence

**Current state:** webcap provides agent-friendly discovery surfaces (`/llms.txt`, `/skill.md`, `/.well-known/x402`, agent card).

**Research direction:** Build deeper agent integration and intelligence features.

#### 4.1 Agent-Optimized Extraction

**Concept:** Format extraction output specifically for LLM consumption (reduced token count, optimized for context windows, structured for tool calling).

**Implementation approach:**
- Add `?format=agent` parameter to extract endpoints
- Generate LLM-optimized output (compressed markdown, key facts only)
- Include extraction metadata (confidence, completeness score)

**Value proposition:**
- Reduces token costs for agent consumption
- Improves agent accuracy with cleaner input
- Creates agent-specific pricing tier

**Estimated effort:** Low (format variant of existing extraction)
**Revenue impact:** Medium (premium agent tier)

#### 4.2 Multi-URL Intelligence

**Concept:** Provide cross-URL intelligence (site-wide content analysis, topic clustering, content gap analysis).

**Implementation approach:**
- Batch extract with cross-page analysis
- Topic clustering using embeddings or LLM-based classification
- Content gap identification against reference pages

**Value proposition:**
- Powers SEO content strategy
- Enables market research automation
- Creates premium intelligence features

**Estimated effort:** High (requires cross-page analysis infrastructure)
**Revenue impact:** High (premium intelligence tier at $0.05/analysis)

#### 4.3 Real-time Intelligence Feeds

**Concept:** Stream change events and intelligence updates to agents via webhooks or server-sent events.

**Implementation approach:**
- Extend watch webhook system with structured intelligence payloads
- Add SSE endpoint for real-time updates
- Create event taxonomy (content_change, structural_change, sentiment_shift, etc.)

**Value proposition:**
- Enables real-time agent reactions
- Powers automated response systems
- Creates premium real-time tier

**Estimated effort:** Medium (extend existing webhook + SSE infrastructure)
**Revenue impact:** High (premium real-time tier)

### 5. Training Data & Model Improvement

**Current state:** webcap logs extraction results, model usage, and change patterns.

**Research direction:** Leverage accumulated data to improve extraction quality and create new data products.

#### 5.1 Extraction Quality Feedback Loop

**Concept:** Use extraction results and user feedback to improve model extraction quality over time.

**Implementation approach:**
- Log extraction confidence scores
- Track which extractions users request repeatedly (suggesting quality issues)
- Fine-tune extraction prompts based on failure patterns

**Value proposition:**
- Improves extraction quality over time
- Reduces model costs through better prompting
- Creates competitive moat through accumulated data

**Estimated effort:** Medium (logging infrastructure + analysis)
**Revenue impact:** High (long-term quality improvement)

#### 5.2 Structured Data Corpus

**Concept:** Build a structured corpus of web page data from extraction results (anonymized, aggregated).

**Implementation approach:**
- Aggregate extraction results across users (opt-in, anonymized)
- Build structured database of web content patterns
- Create web intelligence datasets

**Value proposition:**
- Creates valuable training data for web understanding models
- Enables web-wide content analysis capabilities
- Potential data licensing revenue

**Estimated effort:** High (privacy framework + aggregation infrastructure)
**Revenue impact:** High (potential data licensing revenue)

#### 5.3 Custom Model Training

**Concept:** Offer custom model training for specific domains (e-commerce, news, documentation) using extracted data.

**Implementation approach:**
- Domain-specific extraction models
- Fine-tuned on domain-specific training data
- Offered as premium extraction tier

**Value proposition:**
- Higher accuracy for specific domains
- Creates premium pricing tier
- Builds domain expertise moat

**Estimated effort:** High (model training infrastructure)
**Revenue impact:** High (premium domain-specific tier)

---

## Product Development Roadmap

### Phase 1: Quick Wins (1-2 months) — High Value / Low Effort

#### 1.1 Enhanced Free Preview with Classification
- **What:** Add page classification (article, product, documentation, etc.) to free preview endpoint
- **How:** Extend `modelExtract` with classification prompt; add `classification` field to preview response
- **Value:** Immediately demonstrates AI capabilities; drives upgrades to paid extract
- **Effort:** Low (extend existing model pipeline)

#### 1.2 Watch AI Summary Enhancements
- **What:** Improve AI summaries with multi-turn analysis and trend detection
- **How:** Extend `modelSummarize` with trend analysis prompt; add `trend` field to summary
- **Value:** Provides actionable insights; differentiates from basic monitoring services
- **Effort:** Low (extend existing summarization)

#### 1.3 Agent-Optimized Extraction Format
- **What:** Add `?format=agent` parameter for LLM-optimized output
- **How:** Create format variant that compresses output for token efficiency
- **Value:** Reduces agent costs; creates agent-specific pricing tier
- **Effort:** Low (format variant of existing extraction)

### Phase 2: Intelligence Features (2-4 months) — Medium Value / Medium Effort

#### 2.1 Entity Extraction & Knowledge Graph
- **What:** Extract named entities and build lightweight knowledge graphs
- **How:** LLM-based entity extraction with structured JSON output; entity linking across batch extractions
- **Value:** Powers "extract all companies mentioned" type queries; enables cross-page correlation
- **Effort:** Medium (new extraction schema + entity resolution)

#### 2.2 Screenshot Comparison & Visual Diff
- **What:** Compare screenshots over time and quantify visual changes
- **How:** Pixel diff using canvas-based comparison; layout shift detection; visual similarity scoring
- **Value:** Powers visual change detection; enables visual regression testing
- **Effort:** Medium (new comparison endpoint + storage)

#### 2.3 Accessibility Analysis
- **What:** Analyze pages for accessibility issues (contrast, alt text, heading hierarchy)
- **How:** DOM-based analysis using existing `extractStructureFromDom()`; contrast ratio calculation; WCAG scoring
- **Value:** Enables automated accessibility auditing; powers compliance monitoring
- **Effort:** Medium (new analysis module + scoring)

#### 2.4 Content Sentiment & Readability
- **What:** Analyze page content for sentiment and readability
- **How:** Model-based analysis with structured output; readability scoring; batch comparison
- **Value:** Enables brand monitoring; powers content quality assessment
- **Effort:** Low (extend model extraction with new schemas)

### Phase 3: Predictive Intelligence (4-6 months) — High Value / Higher Effort

#### 3.1 Trend Detection Across Runs
- **What:** Detect trends in watch run data (increasing/decreasing metrics, emerging patterns)
- **How:** Time-series analysis of extracted metrics; anomaly detection; trend visualization
- **Value:** Enables "detect when price changes trend upward" type queries; powers business intelligence
- **Effort:** Medium-High (time-series storage + analysis)

#### 3.2 Competitive Monitoring
- **What:** Monitor competitor pages and detect strategic changes
- **How:** Batch extract with entity/product extraction; change classification; competitive intelligence reports
- **Value:** Enables automated competitive intelligence; powers market research automation
- **Effort:** Medium (extend existing watch + batch extract)

#### 3.3 Multi-URL Intelligence
- **What:** Provide cross-URL intelligence (site-wide content analysis, topic clustering)
- **How:** Batch extract with cross-page analysis; topic clustering; content gap identification
- **Value:** Powers SEO content strategy; enables market research automation
- **Effort:** High (requires cross-page analysis infrastructure)

### Phase 4: Ecosystem Integration (6+ months) — High Value / Higher Effort

#### 4.1 Model Extraction as First-Class Paid Tier
- **What:** Dedicated MODEL_* plan with guaranteed token budgets; SLA on model availability
- **How:** New pricing tier with dedicated model endpoints; token budget management; SLA monitoring
- **Value:** Creates premium pricing tier; improves reliability for model-dependent use cases
- **Effort:** High (infrastructure + SLA framework)

#### 4.2 Agent Discovery & Registration
- **What:** Automated CDP Bazaar/x402index registration via `bin/webcap-keepalive.sh` enhancements
- **How:** Extend keepalive script with Bazaar API integration; automated endpoint submission
- **Value:** Improves discoverability; reduces manual registration effort
- **Effort:** Medium (extend existing keepalive script)

#### 4.3 Advanced Watch AI
- **What:** Multi-turn summarization; change trend detection across run windows; webhook-delivered AI summaries
- **How:** Extend watch scheduler with multi-turn analysis; trend detection; webhook enhancement
- **Value:** Provides deeper insights; differentiates from basic monitoring services
- **Effort:** High (infrastructure + analysis pipeline)

#### 4.4 Cross-Chain Support
- **What:** Add x402 support for Solana MPP route (beyond current Base-only)
- **How:** Extend chain configuration; implement Solana-specific payment handling
- **Value:** Expands addressable market; enables Solana ecosystem integration
- **Effort:** High (cross-chain infrastructure)

---

## Integration Opportunities from Related Projects

### Direct Code Reuse (High Impact)

| Project | Reusable Component | webcap Integration | Estimated Time Saved |
|---|---|---|---|
| **resonance-vision** | `OpenAICompatibleVisionAdapter` | Screenshot analysis, visual classification, accessibility analysis | 2-3 weeks (adapter pattern, image handling, JSON schema enforcement, health checks all reusable) |
| **sensornet** | `sensors/vision.py` (YOLO), `sensors/ocr.py` (Tesseract) | Object detection in screenshots, text extraction from images, UI element analysis | 1-2 weeks (YOLO inference loop, OCR pipeline, frame processing) |
| **model** | `training/train_lora.py`, `training/artifacts.py` | Custom model training for domain-specific extraction | 2-4 weeks (LoRA training pipeline, JSONL data loading, model artifact management) |
| **agentic-graph** | `graph/`, `runtime/scheduler.ts`, `state/sqlite.ts` | Complex multi-step ML pipeline orchestration | 1-2 weeks (graph execution, SQLite persistence, state management) |

### Detailed Integration Plans

#### 1. resonance-vision → Visual Intelligence Features

**What to reuse:**
- `adapter.py`: Complete OpenAI-compatible vision adapter with bounded request/response handling
- `contracts.py`: Visual inspection request/response schemas
- `_json.py`: JSON digest and validation utilities

**How to integrate:**
```typescript
// src/ml/vision/adapter.ts — adapted from resonance-vision
// Reuse the adapter pattern for screenshot analysis
interface VisualAnalysisRequest {
  image_bytes: Buffer;
  media_type: 'image/png' | 'image/jpeg';
  task: 'classification' | 'accessibility' | 'layout' | 'diff';
}

// Use the same JSON schema enforcement pattern
// Use the same bounded request/response handling
// Use the same health check pattern for model endpoints
```

**Specific features enabled:**
- Screenshot classification (article, product, documentation, etc.)
- Accessibility analysis (contrast, alt text, heading hierarchy)
- Layout analysis (visual hierarchy, design patterns)
- Visual diff between screenshots

**Time saved:** 2-3 weeks of adapter development, error handling, schema enforcement

#### 2. sensornet → Object Detection & OCR

**What to reuse:**
- `sensors/vision.py`: YOLO inference loop with frame processing
- `sensors/ocr.py`: Tesseract OCR with preprocessing
- `core/models.py`: Visual detection and OCR text models

**How to integrate:**
```typescript
// src/ml/vision/detect.ts — adapted from sensornet
// Reuse YOLO inference for object detection in screenshots
// Reuse OCR pipeline for text extraction from images

// Python subprocess call to sensornet for heavy ML work:
// python -m sensornet.vision.detect --image screenshot.png --output results.json
```

**Specific features enabled:**
- Object detection in screenshots (buttons, images, forms, navigation)
- Text extraction from screenshots (OCR)
- UI element analysis (interactive elements, layout structure)
- Visual change detection (compare detected objects over time)

**Time saved:** 1-2 weeks of ML pipeline development

#### 3. model → Custom Model Training

**What to reuse:**
- `training/train_lora.py`: Complete LoRA training pipeline
- `training/artifacts.py`: Model artifact management
- `training/json_io.py`: JSONL data loading and validation

**How to integrate:**
```python
# webcap/ml/training/train_extraction_model.py
# Adapt resonance_model's LoRA training for web content extraction

# Training data format (matches webcap's extraction output):
# {"messages": [{"role": "user", "content": "<html>...</html>"}, 
#               {"role": "assistant", "content": "{\"title\": \"...\", \"entities\": [...]}"}]}

# Use existing LoRA training pipeline with web-specific hyperparameters
```

**Specific features enabled:**
- Custom extraction models for specific domains (e-commerce, news, documentation)
- Fine-tuned classification models
- Domain-specific entity extraction models

**Time saved:** 2-4 weeks of training infrastructure development

#### 4. agentic-graph → ML Pipeline Orchestration

**What to reuse:**
- `graph/`: Graph definition and validation
- `runtime/scheduler.ts`: Deterministic scheduler with concurrency limits
- `state/sqlite.ts`: SQLite persistence with WAL mode

**How to integrate:**
```yaml
# webcap/ml/pipelines/web-intelligence.yaml
# Graph definition for multi-step ML analysis
nodes:
  - id: capture
    type: agent
    agent: webcap-capture
  - id: classify
    type: agent
    agent: page-classifier
    depends: [capture]
  - id: extract-entities
    type: agent
    agent: entity-extractor
    depends: [classify]
  - id: analyze-visual
    type: agent
    agent: visual-analyzer
    depends: [capture]
  - id: merge-results
    type: join
    depends: [extract-entities, analyze-visual]
```

**Specific features enabled:**
- Complex multi-step extraction pipelines
- Parallel analysis (visual + text simultaneously)
- Pipeline persistence and recovery
- Concurrency control for ML workloads

**Time saved:** 1-2 weeks of pipeline infrastructure

### Indirect Integration (Medium Impact)

| Project | Feature | Integration Potential |
|---|---|---|
| **freebuff** | Model catalog, agent orchestration | Model extraction UX improvements; agent-aware error messages; shared model infrastructure |
| **resonance** | Marketplace/credit economy | Watch economy design principles; credit-based access controls; federated resource provider pattern |
| **intelligent-compact** | Structural chain guard, training data pipeline | Watch state compaction; training data export for model fine-tuning; structural guard for watch data integrity |
| **observatory** | Causal inference, model graphs | Audit SEO causal analysis; change attribution in watch summaries; model performance tracking |
| **performance** | Benchmarking infrastructure | Performance monitoring, quality metrics, latency tracking |

### Implementation Priority

**Phase 1 (Immediate):**
1. Adapt `resonance-vision` adapter pattern for screenshot analysis
2. Create Python bridge to `sensornet` for YOLO/OCR capabilities

**Phase 2 (Month 2-3):**
3. Adapt `model` training pipeline for custom extraction models
4. Implement `agentic-graph` pattern for ML pipeline orchestration

**Phase 3 (Month 4+):**
5. Full integration of all components
6. Custom model training infrastructure
7. Pipeline monitoring and optimization

---

## Appendix A: Deep Technical Integration Details

### A1. resonance-vision Adapter Pattern → Screenshot Analysis

**Source:** `resonance_vision/adapter.py` (513 lines)

**Reusable Components:**

1. **OpenAI-Compatible Transport Layer** (lines 127-163)
   - `Transport` type alias: `Callable[[str, bytes, Mapping[str, str], float, threading.Event | None], bytes]`
   - Bounded response reading with `MAX_PROVIDER_RESPONSE_BYTES = 96_000`
   - Cancellation support via `threading.Event`
   - Timeout handling with `socket.timeout` and `TimeoutError`

2. **Image Handling** (lines 86-99)
   - `_validate_media_signature()`: Validates PNG/JPEG/WebP magic bytes
   - Base64 encoding for vision requests
   - Media type validation against `MEDIA_TYPES = frozenset({"image/webp", "image/jpeg", "image/png"})`

3. **JSON Schema Enforcement** (lines 395-427)
   - `visual_interpretation_json_schema()`: Generates strict JSON schema for model output
   - `validate_bounded_json()`: Enforces depth, items, string length, and byte limits
   - Structured output via `response_format.type = "json_schema"`

4. **Health Check Pattern** (lines 279-333)
   - Model endpoint health verification
   - Model listing and capability detection
   - `multimodal_advertised` flag for vision model detection

5. **Evidence Collection** (lines 486-513)
   - Request/response metadata logging
   - Latency tracking with `time.monotonic()`
   - Usage statistics extraction

**Adaptation for webcap:**

```typescript
// src/ml/vision/adapter.ts
// Direct port of resonance-vision's OpenAICompatibleVisionAdapter

interface ScreenshotAnalysisRequest {
  image_bytes: Buffer;
  media_type: 'image/png' | 'image/jpeg';
  task: 'classification' | 'accessibility' | 'layout' | 'diff';
  schema?: Record<string, unknown>;  // JSON schema for structured output
}

interface AnalysisResult {
  interpretation: Record<string, unknown>;
  evidence: {
    request_bytes: number;
    response_bytes: number;
    latency_ms: number;
    model: string;
    usage: { prompt_tokens: number; completion_tokens: number };
  };
}

// Reuse the exact same transport pattern
type Transport = (
  url: string,
  payload: Buffer,
  headers: Record<string, string>,
  timeout: number,
  cancelEvent?: AbortSignal
) => Promise<Buffer>;

// Reuse bounded JSON validation
function validateBoundedJSON(value: unknown, limits: {
  maxDepth: number;
  maxItems: number;
  maxLength: number;
  maxBytes: number;
}): void;

// Reuse image signature validation
function validateImageSignature(bytes: Buffer, mediaType: string): boolean;
```

**Time saved:** 2-3 weeks of adapter development, error handling, schema enforcement

### A2. sensornet YOLO + OCR → Object Detection & Text Extraction

**Source:** `sensornet/sensors/vision.py` (99 lines), `sensornet/sensors/ocr.py` (152 lines)

**Reusable Components:**

1. **YOLO Inference Loop** (vision.py lines 26-80)
   - `visual_inference_thread()`: Background YOLO loop targeting `VISION_FPS`
   - Frame processing with `latest_frame_copy()`
   - Result extraction: `boxes.xyxy`, `classes`, `confidences`
   - `VisualDetection` dataclass: `class_name`, `confidence`, `bounds`

2. **OCR Pipeline** (ocr.py lines 54-80)
   - `ocr_frame()`: Run Tesseract on BGR frame
   - Preprocessing: resize, grayscale, Gaussian blur
   - `pytesseract.image_to_data()` with `--psm 11` config
   - Text region tracking with `OCRText` dataclass

3. **World Model Fusion** (grounding.py lines 49-119)
   - `ground_snapshot()`: Fuse AT-SPI + OCR + visual tracks
   - IoU-based element matching with `FUSION_IOU_THRESHOLD`
   - Confidence scoring: named elements get 0.7, interactive +0.15, OCR +0.1, visual +0.05
   - `GroundedElement` dataclass with OCR text and visual labels

4. **Data Models** (core/models.py)
   - `Bounds`: Axis-aligned rectangle with `center`, `area`, `valid()`
   - `UIElement`: AT-SPI element with semantic signature for change detection
   - `VisualDetection`: Single-frame YOLO detection
   - `VisualTrack`: Multi-frame identity for visual objects
   - `OCRText`: Text region with bounds and content

**Adaptation for webcap:**

```typescript
// src/ml/detection/yolo.ts
// Python bridge to sensornet's YOLO inference

interface ObjectDetection {
  class_name: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
}

async function detectObjects(screenshotPath: string): Promise<ObjectDetection[]> {
  // Call sensornet as subprocess
  const result = await exec(`PYTHONPATH=/home/shoutsid/code/sensornet python3 -c "
import sys
sys.path.insert(0, '/home/shoutsid/code/sensornet')
from sensornet.sensors.vision import YOLO
from ultralytics import YOLO
model = YOLO('yolo26n.pt')
results = model('${screenshotPath}', verbose=False)
detections = []
for r in results:
  if r.boxes is not None:
    for i in range(len(r.boxes.xyxy)):
      x1,y1,x2,y2 = r.boxes.xyxy[i].cpu().numpy()
      detections.append({
        'class_name': model.names[int(r.boxes.cls[i])],
        'confidence': float(r.boxes.conf[i]),
        'bounds': {'x': int(x1), 'y': int(y1), 'width': int(x2-x1), 'height': int(y2-y1)}
      })
import json
print(json.dumps(detections))
"`);
  return JSON.parse(result.stdout);
}

// src/ml/detection/ocr.ts
// Python bridge to sensornet's OCR pipeline

async function extractTextFromImage(imagePath: string): Promise<{
  text: string;
  regions: Array<{ text: string; bounds: Bounds; confidence: number }>;
}> {
  const result = await exec(`PYTHONPATH=/home/shoutsid/code/sensornet python3 -c "
import sys
sys.path.insert(0, '/home/shoutsid/code/sensornet')
import cv2
import pytesseract
from pytesseract import Output

frame = cv2.imread('${imagePath}')
gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
gray = cv2.GaussianBlur(gray, (3, 3), 0)
data = pytesseract.image_to_data(gray, output_type=Output.DICT, config='--psm 11')

regions = []
for i in range(len(data['text'])):
  if data['text'][i].strip():
    regions.append({
      'text': data['text'][i],
      'bounds': {
        'x': data['left'][i],
        'y': data['top'][i],
        'width': data['width'][i],
        'height': data['height'][i]
      },
      'confidence': data['conf'][i] / 100.0
    })

import json
print(json.dumps({
  'text': ' '.join(r['text'] for r in regions),
  'regions': regions
}))
"`);
  return JSON.parse(result.stdout);
}

// src/ml/detection/grounding.ts
// Adapted from sensornet/sensors/grounding.py

interface GroundedElement {
  id: string;
  role: string;
  name: string;
  bounds: Bounds | null;
  ocr_text: string[];
  visual_labels: string[];
  description: string;
  confidence: number;
}

function groundSnapshot(snapshot: {
  ui: Record<string, UIElement>;
  visual: Record<string, VisualTrack>;
  text: Record<string, OCRText>;
}): GroundedElement[] {
  // Port of sensornet's ground_snapshot()
  // Fuses AT-SPI, OCR, and visual tracks with IoU-based matching
}
```

**Time saved:** 1-2 weeks of ML pipeline development

### A3. model Training Pipeline → Custom Model Training

**Source:** `model/resonance_model/training/train_lora.py` (771 lines)

**Reusable Components:**

1. **JSONL Data Loading** (lines 25-39)
   - `load_records()`: Load JSONL with `messages` array validation
   - Record format: `{"messages": [{"role": "user", ...}, {"role": "assistant", ...}]}`

2. **LoRA Configuration** (lines 47-90)
   - `resolve_lora_settings()`: Extract rank, alpha, dropout, target_modules
   - Continuation training validation (preserves adapter settings)
   - Base model binding verification

3. **Training Plan Construction** (lines 200-250)
   - `build_training_plan()`: Calculate optimizer steps from batch_size, gradient_accumulation, epochs
   - Max steps enforcement
   - Record count validation

4. **Candidate Plan Validation** (lines 118-198)
   - `validate_candidate_plan_binding()`: Bind config, dataset, adapter, output
   - SHA256 verification for all artifacts
   - Training parameter consistency checks

5. **Precision Handling** (lines 92-115)
   - `normalize_precision()`: auto/fp32/fp16/bf16
   - `resolve_runtime_precision()`: CUDA detection, bf16 support check

6. **Artifact Management** (`training/artifacts.py`)
   - `file_sha256()`: Streaming SHA256 for large files
   - `directory_content_sha256()`: Bind directory to sorted paths, sizes, digests

**Adaptation for webcap:**

```typescript
// src/ml/training/data.ts
// Adapted from model/resonance_model/training/train_lora.py

interface TrainingRecord {
  messages: Array<{ role: string; content: string }>;
}

function loadJSONLRecords(path: string): TrainingRecord[] {
  // Port of load_records() with webcap-specific validation
  // Validate messages array, role/content types
}

// src/ml/training/config.ts
// Adapted from model's LoRA configuration

interface LoRAConfig {
  rank: number;
  alpha: number;
  dropout: number;
  target_modules: string[];
  base_model: string;
  epochs: number;
  learning_rate: number;
  batch_size: number;
  gradient_accumulation_steps: number;
}

function resolveLoRASettings(config: LoRAConfig, startingAdapter?: AdapterConfig): LoRAConfig {
  // Port of resolve_lora_settings()
  // Validate continuation training preserves settings
}

// src/ml/training/plan.ts
// Adapted from model's training plan construction

interface TrainingPlan {
  optimizer_steps: number;
  total_tokens: number;
  estimated_duration_seconds: number;
}

function buildTrainingPlan(config: LoRAConfig, recordCount: number): TrainingPlan {
  // Port of build_training_plan()
  // Calculate steps from batch_size, gradient_accumulation, epochs
}

// src/ml/training/artifacts.ts
// Adapted from model/resonance_model/training/artifacts.py

function fileSHA256(path: string): string {
  // Port of file_sha256() with streaming hash
}

function directoryContentSHA256(path: string): { digest: string; inventory: FileEntry[] } {
  // Port of directory_content_sha256()
}
```

**Time saved:** 2-4 weeks of training infrastructure

### A4. agentic-graph Runtime → Pipeline Orchestration

**Source:** `agentic-graph/src/state/sqlite.ts` (535 lines), `agentic-graph/src/graph/types.ts` (293 lines)

**Reusable Components:**

1. **SQLite Schema** (sqlite.ts lines 27-99)
   - `graphs` table: Versioned graph definitions
   - `runs` table: Graph execution state with parent/child relationships
   - `node_runs` table: Per-node execution state with attempts, input/output
   - `events` table: Event sourcing with sequence numbers
   - `artifacts` table: Output artifacts with content hashing
   - WAL mode for concurrent readers

2. **Type System** (types.ts)
   - `GraphStatus`: created | running | paused | waiting | completed | failed | cancelled
   - `NodeStatus`: pending | ready | running | waiting | completed | failed | skipped | cancelled
   - `NodeDefinition`: agent | condition | parallel | join | human | graph
   - `RetryPolicy`: maxAttempts, backoff strategy, initial/max delay
   - `JoinStrategy`: all | any | quorum

3. **Scheduler Pattern** (scheduler.ts)
   - Readiness evaluation with dependency tracking
   - Concurrency limits: `maxConcurrentNodes`, `maxConcurrentAgents`
   - Deadlock detection with `GraphDeadlockError`
   - Crash recovery of incomplete runs

**Adaptation for webcap:**

```typescript
// src/ml/pipeline/schema.ts
// Direct port of agentic-graph's SQLite schema

const ML_PIPELINE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ml_pipelines (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS ml_runs (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  pipeline_version INTEGER NOT NULL,
  parent_run_id TEXT,
  parent_node_id TEXT,
  status TEXT NOT NULL,
  input_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS ml_node_runs (
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  input_json TEXT,
  output_json TEXT,
  error_json TEXT,
  started_at TEXT,
  completed_at TEXT,
  PRIMARY KEY (run_id, node_id)
);

CREATE TABLE IF NOT EXISTS ml_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  node_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);
`;

// src/ml/pipeline/types.ts
// Adapted from agentic-graph's type system

type MLPipelineStatus = 'created' | 'running' | 'paused' | 'completed' | 'failed';
type MLNodeStatus = 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped';

interface MLNodeDefinition {
  type: 'capture' | 'classify' | 'extract' | 'detect' | 'analyze' | 'merge';
  agent?: string;
  prompt?: string;
  input?: Record<string, string>;
  output?: Record<string, unknown>;
  timeoutMs?: number;
  retry?: {
    maxAttempts: number;
    backoff: 'linear' | 'exponential';
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
}

interface MLEdgeDefinition {
  from: string;
  to: string;
  condition?: string;
}

interface MLPipelineDefinition {
  id: string;
  version: number;
  name: string;
  nodes: Record<string, MLNodeDefinition>;
  edges: MLEdgeDefinition[];
  entryNodes: string[];
}

// src/ml/pipeline/scheduler.ts
// Adapted from agentic-graph's scheduler

class MLPipelineScheduler {
  constructor(
    private db: Database,
    private config: {
      maxConcurrentNodes: number;
      maxConcurrentAgents: number;
    }
  ) {}

  async tick(): Promise<void> {
    // Port of Scheduler.tick()
    // 1. Find runnable nodes (all dependencies satisfied)
    // 2. Check concurrency limits
    // 3. Execute ready nodes
    // 4. Handle completions and failures
    // 5. Detect deadlocks
  }

  async recoverIncompleteRuns(): Promise<void> {
    // Port of Scheduler recovery logic
    // Resume runs that were interrupted
  }
}
```

**Time saved:** 1-2 weeks of pipeline infrastructure

### A5. Cross-Project Integration Patterns

**Pattern 1: Python Bridge for ML Inference**

```typescript
// src/ml/bridge.ts
// Unified interface to Python ML components

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class PythonMLBridge {
  private pythonPath: string;
  private sensornetPath: string;

  constructor() {
    this.pythonPath = 'python3';
    this.sensornetPath = '/home/shoutsid/code/sensornet';
  }

  async runPython(script: string): Promise<string> {
    const { stdout, stderr } = await execAsync(
      `PYTHONPATH=${this.sensornetPath} ${this.pythonPath} -c "${script}"`
    );
    if (stderr) console.error('Python stderr:', stderr);
    return stdout;
  }

  async detectObjects(imagePath: string): Promise<ObjectDetection[]> {
    const script = `
import sys
sys.path.insert(0, '${this.sensornetPath}')
from sensornet.sensors.vision import YOLO
# ... detection logic
`;
    const result = await this.runPython(script);
    return JSON.parse(result);
  }

  async extractText(imagePath: string): Promise<OCRResult> {
    const script = `
import sys
sys.path.insert(0, '${this.sensornetPath}')
import cv2
import pytesseract
# ... OCR logic
`;
    const result = await this.runPython(script);
    return JSON.parse(result);
  }
}
```

**Pattern 2: Shared SQLite Schema**

```typescript
// src/ml/pipeline/store.ts
// Adapted from agentic-graph's SQLite store

import Database from 'better-sqlite3';

export class MLPipelineStore {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(ML_PIPELINE_SCHEMA);
  }

  // Port of StateStore methods from agentic-graph
  async savePipeline(pipeline: MLPipelineDefinition): Promise<void>;
  async loadPipeline(id: string, version: number): Promise<MLPipelineDefinition>;
  async createRun(pipelineId: string, input: Record<string, unknown>): Promise<string>;
  async updateNodeRun(runId: string, nodeId: string, update: NodeRunUpdate): Promise<void>;
  async getRunnableNodes(runId: string): Promise<MLNodeDefinition[]>;
}
```

**Pattern 3: Event Sourcing for ML Operations**

```typescript
// src/ml/events.ts
// Adapted from agentic-graph's event bus

export interface MLNodeEvent {
  type: 'node_started' | 'node_completed' | 'node_failed' | 'node_skipped';
  runId: string;
  nodeId: string;
  timestamp: Date;
  payload?: Record<string, unknown>;
}

export class MLEventBus {
  private listeners: Map<string, Function[]> = new Map();

  on(eventType: string, handler: Function): void {
    const handlers = this.listeners.get(eventType) || [];
    handlers.push(handler);
    this.listeners.set(eventType, handlers);
  }

  emit(event: MLNodeEvent): void {
    const handlers = this.listeners.get(event.type) || [];
    handlers.forEach(handler => handler(event));
  }
}
```

### A6. Estimated Implementation Effort

| Component | Lines of Code | Effort | Notes |
|---|---|---|---|
| resonance-vision adapter port | ~300 | 1 week | Direct port with TypeScript types |
| sensornet YOLO bridge | ~100 | 2-3 days | Python subprocess calls |
| sensornet OCR bridge | ~150 | 2-3 days | Python subprocess calls |
| sensornet grounding fusion | ~150 | 3-4 days | Port IoU matching and confidence scoring |
| model training data loader | ~100 | 1-2 days | JSONL parsing with validation |
| model LoRA config | ~150 | 2-3 days | Config resolution and validation |
| model artifact management | ~50 | 1 day | SHA256 hashing |
| agentic-graph SQLite schema | ~100 | 1-2 days | Direct SQL port |
| agentic-graph type system | ~200 | 2-3 days | TypeScript type definitions |
| agentic-graph scheduler | ~400 | 1 week | Complex scheduling logic |
| Python bridge layer | ~200 | 2-3 days | Subprocess management |
| **Total** | **~1,900** | **~3 weeks** | **Focused implementation** |

---

## Technical Architecture Recommendations

### Current Architecture Strengths
1. **Clean separation of concerns**: Capture pipeline (`src/capture/`), extraction service (`src/extract/`), watch scheduler (`src/watch/`), server routes (`src/server/`)
2. **Fail-open design**: Model extraction gracefully falls back to deterministic extraction
3. **Token budget management**: Watch AI summaries have per-watch and global token budgets
4. **Batch economics**: Single payment covers up to 50 URLs with flat pricing
5. **Agent-native discovery**: Comprehensive discovery surfaces for AI agents

### Recommended Architecture Enhancements

#### 1. ML Pipeline Abstraction
```
src/ml/
  classifier.ts       # Page classification
  entities.ts         # Entity extraction
  sentiment.ts        # Sentiment analysis
  vision.ts           # Visual analysis (diff, accessibility)
  trends.ts           # Trend detection
  models.ts           # Model management and routing
```

**Benefit:** Clean separation of ML features; easy to add new capabilities; reusable across routes.

#### 2. Feature Flag System
```typescript
// src/config/features.ts
export interface FeatureFlags {
  entityExtraction: boolean;
  visualAnalysis: boolean;
  sentimentAnalysis: boolean;
  trendDetection: boolean;
  accessibilityAnalysis: boolean;
}
```

**Benefit:** Gradual rollout; A/B testing; feature-specific pricing tiers.

#### 3. Caching Layer
```
src/cache/
  extraction.ts       # Cache extraction results by URL + schema hash
  classification.ts   # Cache page classifications
  entities.ts         # Cache entity extraction results
  visual.ts           # Cache visual analysis results
```

**Benefit:** Reduces model costs; improves response times; enables analytics.

#### 4. Analytics Pipeline
```
src/analytics/
  extraction.ts       # Track extraction quality metrics
  modelUsage.ts       # Track model usage and costs
  trends.ts           # Track trend detection accuracy
  revenue.ts          # Track revenue by feature
```

**Benefit:** Data-driven feature development; cost optimization; quality monitoring.

### Database Schema Enhancements

#### New Tables for ML Features
```sql
-- Page classifications
CREATE TABLE classifications (
  id TEXT PRIMARY KEY,
  url_hash TEXT NOT NULL,
  classification TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL
);

-- Entity extraction results
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  extraction_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_value TEXT NOT NULL,
  confidence REAL,
  created_at TEXT NOT NULL
);

-- Visual analysis results
CREATE TABLE visual_analysis (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL,
  analysis_type TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Trend data
CREATE TABLE trends (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## Pricing Strategy for ML Features

### Tiered Pricing Model

| Tier | Features | Price |
|---|---|---|
| **Basic** | Screenshot, extract, audit, map-lite, video | Current pricing ($0.001-$0.01) |
| **Intelligence** | + Classification, entities, sentiment | +$0.002/extraction |
| **Vision** | + Visual diff, accessibility analysis | +$0.005/analysis |
| **Predictive** | + Trend detection, competitive monitoring | +$0.01/analysis |
| **Enterprise** | + Custom models, SLA, dedicated support | Custom pricing |

### Revenue Projections

**Conservative (Phase 1-2):**
- Current monthly revenue: ~$50 (estimated from unit economics)
- With classification + entities: +$20 (40% increase)
- With visual analysis: +$15 (30% increase)
- Total: ~$85/month (70% increase)

**Moderate (Phase 3-4):**
- With trend detection + competitive monitoring: +$30
- With enterprise tier: +$50
- Total: ~$165/month (230% increase)

**Optimistic (Full rollout):**
- With data licensing + custom models: +$100
- Total: ~$265/month (430% increase)

---

## Recommendations

1. **Prioritize Phase 1 quick wins** — Classification, agent-optimized format, and enhanced AI summaries provide immediate value with minimal risk
2. **Build ML pipeline abstraction first** — Create clean separation for ML features before adding capabilities
3. **Implement caching early** — Reduces model costs and improves response times
4. **Monitor model extraction usage** — Track `modelUsage` from enhanced preview to inform Phase 2 prioritization
5. **Consider feature flags** — Enable gradual rollout and A/B testing for ML features
6. **Enable CDP Bazaar authentication** — Set `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` for Bazaar discovery
7. **Build analytics infrastructure** — Track extraction quality, model usage, and revenue by feature
8. **Consider accessibility analysis** — Differentiates from pure extraction services; enables compliance monitoring
9. **Explore entity extraction** — Powers "extract all companies mentioned" type queries; enables cross-page correlation
10. **Plan for data licensing** — Accumulated extraction data creates potential licensing revenue

---

## Conclusion

The x402 ecosystem has reached significant scale (75M+ transactions, $24M+ volume) with webcap well-positioned as a foundational "eyes and ears" service. The competitive landscape shows a gap in **ML-powered intelligence features** — most competitors offer raw extraction, not actionable insights.

The highest-ROI path forward is to:
1. **Extend existing model extraction** with classification, entities, and sentiment (Phase 1-2)
2. **Add visual intelligence** with screenshot comparison and accessibility analysis (Phase 2)
3. **Build predictive capabilities** with trend detection and competitive monitoring (Phase 3)
4. **Create data products** from accumulated extraction data (Phase 4)

This approach leverages existing infrastructure (model pipeline, watch scheduler, batch economics) while creating premium pricing tiers and competitive moats through accumulated data and intelligence capabilities.

**Next immediate action:** Enable CDP Bazaar authentication by setting `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` in `.env`, then make one paid call to trigger Bazaar indexing and verify listing presence. Then implement Phase 1.1 (enhanced free preview with classification) to demonstrate AI capabilities immediately.

---

## Appendix: Time Savings Summary

### Total Estimated Time Savings from Code Reuse

| Phase | Without Reuse | With Reuse | Savings |
|---|---|---|---|
| Phase 1 (Quick Wins) | 6-8 weeks | 2-3 weeks | **4-5 weeks (60%)** |
| Phase 2 (Intelligence) | 12-16 weeks | 6-8 weeks | **6-8 weeks (50%)** |
| Phase 3 (Predictive) | 8-12 weeks | 4-6 weeks | **4-6 weeks (50%)** |
| Phase 4 (Ecosystem) | 12-16 weeks | 8-10 weeks | **4-6 weeks (35%)** |
| **Total** | **38-52 weeks** | **20-27 weeks** | **18-25 weeks (47%)** |

### Key Reusable Components

1. **resonance-vision adapter** (513 lines) → Visual intelligence features
   - Image handling, JSON schema enforcement, health checks
   - **Saves:** 2-3 weeks of adapter development

2. **sensornet YOLO + OCR** (250+ lines) → Object detection, text extraction
   - ML inference pipeline, preprocessing, postprocessing
   - **Saves:** 1-2 weeks of ML pipeline development

3. **model LoRA training** (771 lines) → Custom model training
   - Training pipeline, artifact management, data loading
   - **Saves:** 2-4 weeks of training infrastructure

4. **agentic-graph runtime** (600+ lines) → Pipeline orchestration
   - Graph execution, scheduling, persistence
   - **Saves:** 1-2 weeks of pipeline infrastructure

### Architecture Recommendation

Create a `webcap/ml/` directory with:

```
webcap/ml/
├── vision/                  # Adapted from resonance-vision
│   ├── adapter.ts           # OpenAI-compatible vision adapter
│   ├── contracts.ts         # Request/response schemas
│   └── health.ts            # Model endpoint health checks
├── detection/               # Adapted from sensornet
│   ├── yolo.ts              # YOLO object detection bridge
│   ├── ocr.ts               # Tesseract OCR bridge
│   └── models.ts            # Detection result models
├── training/                # Adapted from model
│   ├── train_lora.ts        # LoRA training pipeline
│   ├── artifacts.ts         # Model artifact management
│   └── data.ts              # JSONL data loading
├── pipeline/                # Adapted from agentic-graph
│   ├── graph.ts             # Pipeline graph definitions
│   ├── scheduler.ts         # Pipeline execution scheduler
│   └── state.ts             # Pipeline state persistence
└── index.ts                 # Public API exports
```

This architecture maximizes code reuse while maintaining clean separation of concerns.
