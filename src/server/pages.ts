/**
 * The webcap public web surfaces: the product landing page (GET /) and the
 * shareable artifact page (GET /v1/artifacts/:id/page).
 *
 * Design system: there is no separate frontend, so the token system lives here
 * as CSS custom properties (BASE_CSS) shared verbatim by both pages — both
 * surfaces render from the same palette, spacing scale, type scale and
 * component primitives (top bar, panels, code terminal, buttons, meta grid).
 * No frameworks, no external assets, no JavaScript.
 *
 * All user-influenced values (source URLs, ids, formats, timestamps) pass
 * through esc() before interpolation.
 */
import type { WebcapConfig } from '../config.js';
import { USDC_SCALE } from '../config.js';
import type { ArtifactRow } from '../db/artifacts.js';

/** CDP Bazaar catalog where settled webcap payments get indexed. */
const BAZAAR_CATALOG_URL = 'https://cdp.coinbase.com';

/** Escape a value that is influenced by input (URLs, ids) before HTML embedding. */
export function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Human-readable byte size: "8 B", "12.4 KB", "1.2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`;
}

/** SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC) -> "YYYY-MM-DD HH:MM UTC". */
export function readableCapturedAt(sqliteUtc: string): string {
  const iso = `${sqliteUtc.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return sqliteUtc;
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Atomic 6-decimal USDC units -> "$0.001" (shortest decimal rendering). */
function usd(atomicUnits: number): string {
  return `$${atomicUnits / USDC_SCALE}`;
}

// ---------------------------------------------------------------------------
// Shared design tokens + primitives (landing + artifact page render from these)
// ---------------------------------------------------------------------------

const BASE_CSS = `
:root{
  --bg:#0a0e17; --panel:#101624; --panel-2:#0d1322;
  --line:#232d44; --line-soft:#182034;
  --text:#eaf0fa; --muted:#94a1b9; --faint:#5c6982;
  --accent:#f5b84b; --accent-dim:#8a6a24; --accent-ink:#181205; --rec:#ff6159; --ok:#59d499;
  --code:#c7d2e8; --code-link:#9ecbff;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px; --s9:96px;
  --r-s:6px; --r-m:10px; --r-l:14px;
  --shadow:0 16px 48px rgba(3,6,14,.5);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:16px;line-height:1.6}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:var(--mono);font-size:.9em;background:var(--panel-2);border:1px solid var(--line-soft);border-radius:var(--r-s);padding:1px 6px}
h1,h2,h3{margin:0;line-height:1.15}
h2{font-size:clamp(24px,3.4vw,34px);letter-spacing:-.01em}
p{margin:0}
.wrap{max-width:1060px;margin:0 auto;padding:0 var(--s5)}
.top{border-bottom:1px solid var(--line-soft)}
.top .wrap{display:flex;justify-content:space-between;align-items:center;padding-top:var(--s4);padding-bottom:var(--s4)}
.brand{display:flex;align-items:center;gap:var(--s2);font-family:var(--mono);font-weight:700;font-size:18px;color:var(--text)}
.brand:hover{text-decoration:none}
.brand-mark{width:14px;height:14px;border:2px solid var(--accent);border-radius:3px;position:relative;flex:none}
.brand-mark::after{content:"";position:absolute;inset:3px;background:var(--rec);border-radius:1px}
.top nav{display:flex;gap:var(--s4)}
.top nav a{font-family:var(--mono);font-size:13px;color:var(--muted)}
.top nav a:hover{color:var(--text);text-decoration:none}
.kicker{font-family:var(--mono);font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.kicker .rec{color:var(--rec)}
.btn{display:inline-block;font-family:var(--mono);font-size:14px;font-weight:700;padding:10px 18px;border-radius:var(--r-m);background:var(--accent);border:1px solid var(--accent);color:var(--accent-ink)}
.btn:hover{text-decoration:none;filter:brightness(1.06)}
.btn.ghost{background:transparent;border-color:var(--line);color:var(--text)}
.section{padding:var(--s8) 0}
.hint{color:var(--muted);max-width:64ch;margin-top:var(--s3);font-size:15px}
.term{background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-l);box-shadow:var(--shadow);overflow:hidden}
.term-bar{display:flex;align-items:center;gap:var(--s2);padding:10px var(--s4);border-bottom:1px solid var(--line-soft);font-family:var(--mono);font-size:12px;color:var(--faint)}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.dot.r{background:var(--rec)}.dot.y{background:var(--accent)}.dot.g{background:var(--ok)}
.term pre{margin:0;padding:var(--s4);overflow-x:auto;font-family:var(--mono);font-size:12.5px;line-height:1.65;color:var(--code)}
.term .c{color:var(--faint)}
.term .k{color:var(--accent)}
.term .s{color:var(--code-link)}
.term .ok{color:var(--ok)}
footer{border-top:1px solid var(--line-soft);color:var(--faint);font-size:13.5px}
footer .wrap{padding-top:var(--s6);padding-bottom:var(--s8)}
.foot-row{display:flex;justify-content:space-between;gap:var(--s4);flex-wrap:wrap}
.foot-row a{font-family:var(--mono);font-size:13px}
`;

// Landing-only primitives
const LANDING_CSS = `
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:var(--s7);align-items:center;padding:var(--s9) 0 var(--s7)}
@media (max-width:880px){.hero{grid-template-columns:1fr;padding:var(--s8) 0 var(--s6)}}
.hero h1{font-size:clamp(34px,5.4vw,58px);letter-spacing:-.02em;font-weight:800;margin-top:var(--s4)}
.lede{color:var(--muted);font-size:clamp(16px,1.8vw,19px);max-width:54ch;margin-top:var(--s4)}
.cta-row{display:flex;gap:var(--s3);margin-top:var(--s5);flex-wrap:wrap}
.micro{color:var(--faint);font-size:13.5px;margin-top:var(--s4)}
.price-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s4);margin-top:var(--s5)}
@media (max-width:880px){.price-grid{grid-template-columns:1fr}}
.price{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);padding:var(--s5)}
.price h3{font-size:13px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.price .amount{font-size:34px;font-weight:800;letter-spacing:-.02em;margin:var(--s3) 0 var(--s2)}
.price .amount small{font-size:14px;color:var(--faint);font-weight:500}
.price p{color:var(--muted);font-size:14px}
.price .tag{font-family:var(--mono);font-size:12px;color:var(--accent);display:block;margin-top:var(--s3)}
.steps{counter-reset:step;list-style:none;margin:var(--s5) 0 0;padding:0;display:grid;gap:var(--s3)}
.steps li{position:relative;padding:var(--s4) var(--s4) var(--s4) 60px;background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m)}
.steps li::before{counter-increment:step;content:counter(step);position:absolute;left:var(--s4);top:var(--s4);width:28px;height:28px;display:grid;place-items:center;font-family:var(--mono);font-size:13px;color:var(--accent);border:1px solid var(--accent-dim);border-radius:50%}
.steps li p{margin-top:4px;color:var(--muted);font-size:14px}
.sub-h{font-size:18px;margin-top:var(--s6);margin-bottom:var(--s3)}
.link-strip{display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:var(--s5)}
.link-strip a{font-family:var(--mono);font-size:13px;border:1px solid var(--line);border-radius:var(--r-m);padding:10px 14px;color:var(--text);display:inline-flex;gap:8px;align-items:center}
.link-strip a:hover{border-color:var(--accent);text-decoration:none}
`;

// Artifact-page primitives
const ARTIFACT_CSS = `
.crumb{font-family:var(--mono);font-size:12.5px;color:var(--faint)}
.artifact-main{padding:var(--s6) 0 var(--s8)}
.artifact-main h1{font-size:clamp(20px,3vw,28px);word-break:break-all;margin:var(--s3) 0 var(--s5)}
.frame{margin:0;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-l);padding:var(--s4);position:relative}
.frame::before{content:"";position:absolute;inset:10px;border:1px solid var(--line);border-radius:var(--r-m);pointer-events:none}
.frame img{display:block;max-width:100%;border-radius:var(--r-m);border:1px solid var(--line-soft);position:relative}
.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3);margin:var(--s5) 0}
@media (max-width:640px){.meta{grid-template-columns:1fr}}
.meta div{background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m);padding:var(--s3) var(--s4)}
.meta dt{font-family:var(--mono);font-size:11.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint)}
.meta dd{margin:4px 0 0;font-family:var(--mono);font-size:14.5px}
.get{color:var(--muted);font-size:14.5px;margin-bottom:var(--s5)}
`;

function topBar(): string {
  return `<div class="top"><div class="wrap">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>webcap</a>
  <nav>
    <a href="/openapi.json">openapi.json</a>
    <a href="${BAZAAR_CATALOG_URL}" target="_blank" rel="noopener">CDP Bazaar</a>
    <a href="/icon.png">icon.png</a>
  </nav>
</div></div>`;
}

function footer(): string {
  return `<footer><div class="wrap"><div class="foot-row">
  <span>webcap — pay-per-call web capture. No keys, no accounts, USDC over x402.</span>
  <span><a href="/">landing</a> · <a href="/openapi.json">OpenAPI</a> · <a href="${BAZAAR_CATALOG_URL}" target="_blank" rel="noopener">Bazaar</a> · <a href="/icon.png">icon</a></span>
</div></div></footer>`;
}

const termBar = (label: string): string =>
  `<div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span style="margin-left:var(--s2)">${esc(label)}</span></div>`;

// ---------------------------------------------------------------------------
// GET / — product landing page
// ---------------------------------------------------------------------------

export function landingHtml(config: WebcapConfig): string {
  const base = config.publicBaseUrl;
  const capturePrice = usd(config.x402PriceUsdcUnits);
  const extractPrice = usd(config.x402ExtractPriceUsdcUnits);
  // 100-run top-up packs (the monitoring prices), always two-decimal.
  const captureTopUpPrice = `$${(config.x402PriceUsdcUnits * 100 / USDC_SCALE).toFixed(2)}`;
  const extractTopUpPrice = `$${(config.x402ExtractPriceUsdcUnits * 100 / USDC_SCALE).toFixed(2)}`;

  const curlFlow = `<span class="c"># 1) POST without payment — you get HTTP 402 + a PAYMENT-REQUIRED</span>
<span class="c">#    response header: a base64-encoded JSON challenge</span>
curl -si -X POST "${base}/v1/x402/capture" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"url":"https://example.com/"}'</span>

<span class="c">#    decode the challenge:</span>
<span class="k">PAYMENT-REQUIRED:</span> &lt;base64&gt;
base64 -d &lt;&lt;&lt; <span class="s">'$PAYMENT_REQUIRED'</span>
<span class="c">#  → {"x402Version":2,"error":"Payment required",</span>
<span class="c">#     "accepts":[{"scheme":"exact","network":"eip155:84532","asset":"0x…USDC",</span>
<span class="c">#                 "amount":"1000","payTo":"0x…","maxTimeoutSeconds":300,</span>
<span class="c">#                 "extra":{"name":"USDC","version":"2"}],</span>
<span class="c">#     "resource":{…}, "extensions":{"bazaar":{…}}}</span>

<span class="c"># 2) Sign a gasless EIP-3009 transferWithAuthorization:</span>
<span class="c">#    from = your wallet, to = payTo, value = amount (6-decimal USDC).</span>
<span class="c">#    The facilitator submits the tx and pays gas — no ETH needed.</span>

<span class="c"># 3) Retry with the signature — the facilitator verifies + settles on-chain</span>
curl -s -X POST "${base}/v1/x402/capture" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -H <span class="s">'PAYMENT-SIGNATURE: &lt;base64 payment payload&gt;'</span> \\
  -d <span class="s">'{"url":"https://example.com/"}'</span>
<span class="ok">→ 200</span> {"artifact":{"format":"png","bytes":…,"data":"&lt;base64&gt;","url":"…/v1/artifacts/&lt;id&gt;"},
       "payment":{"payer":"0x…","priceUsdcUnits":1000}}`;

  const agentSnippet = `<span class="c">// any x402 v2 HTTP client works — example with @x402/axios:</span>
<span class="c">// Base Sepolia USDC · x402 v2 "exact" scheme · gasless EIP-3009</span>
import axios from 'axios';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY);
const client = new x402Client().register('eip155:84532', new ExactEvmScheme(account));

<span class="c">// the wrapper handles 402 → sign PAYMENT-SIGNATURE → retry automatically</span>
const api = wrapAxiosWithPayment(axios.create({ baseURL: '${base}' }), client);
const res = await api.post('/v1/x402/capture', { url: 'https://example.com/' });
console.log(res.data.artifact.url); <span class="c">// 200 — paid, settled, screenshot served</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>webcap — pay-per-call web capture API (x402 USDC)</title>
<meta name="description" content="webcap turns any URL into a PNG/JPEG/PDF screenshot + Open Graph metadata, or structured text/JSON from batch extraction. Pay per call in USDC over x402 micropayments — no API keys, no accounts, gasless.">
<link rel="icon" href="/icon.png">
<style>${BASE_CSS}${LANDING_CSS}</style>
</head>
<body>
${topBar()}
<main>
  <section class="hero wrap">
    <div>
      <p class="kicker"><span class="rec">●</span> REC — pay-per-call web capture</p>
      <h1>Screenshot any URL.<br>Pay per call, on-chain.</h1>
      <p class="lede">webcap is a web capture API: point it at a URL and get a
        <strong>PNG / JPEG / PDF screenshot</strong> plus free Open Graph metadata — or a
        <strong>batch extract</strong> that returns structured text/JSON (title, headings,
        paragraphs, links, images, document-order markdown). Every call is paid in
        <strong>USDC over x402 micropayments</strong> (HTTP 402): no API keys, no accounts,
        no gas — the facilitator settles the gasless EIP-3009 transfer for the payer.</p>
      <div class="cta-row">
        <a class="btn" href="#pay">How to pay</a>
        <a class="btn ghost" href="/openapi.json">OpenAPI spec</a>
      </div>
      <p class="micro">Free preview, no payment: <code>GET /v1/extract/preview?url=…</code> (rate-limited)</p>
    </div>
    <div class="term" aria-label="curl example of the x402 payment flow">
      ${termBar('402 → PAYMENT-REQUIRED → sign → retry')}
      <pre><code>${curlFlow}</code></pre>
    </div>
  </section>

  <section class="section wrap" id="pricing">
    <h2>Pricing</h2>
    <p class="hint">Flat per-call prices. Compute costs are covered by us — you pay only
      for the capture, settled in USDC on the chain your client targets (Base Sepolia /
      Base mainnet).</p>
    <div class="price-grid">
      <div class="price">
        <h3>Capture</h3>
        <div class="amount">${esc(capturePrice)} <small>/ URL</small></div>
        <p>PNG, JPEG or PDF screenshot of any public URL, plus free OG metadata.
          The artifact is stored and served at <code>/v1/artifacts/&lt;id&gt;</code>
          with a shareable page.</p>
        <span class="tag">POST /v1/x402/capture</span>
      </div>
      <div class="price">
        <h3>Extract</h3>
        <div class="amount">${esc(extractPrice)} <small>/ URL batch</small></div>
        <p>Structured text/JSON — title, description, headings, paragraphs, links,
          images, word count, clean markdown. Batch up to 10 URLs for one payment;
          optional model extraction via a natural-language schema.</p>
        <span class="tag">POST /v1/x402/extract</span>
      </div>
      <div class="price">
        <h3>Compute</h3>
        <div class="amount">$0 <small>/ covered</small></div>
        <p>Browser rendering, page loads and storage are on us — amortized compute
          cost is already inside the per-call price. No minimums, no markup, no
          credit packs required for x402 calls.</p>
        <span class="tag">covered by webcap</span>
      </div>
    </div>
  </section>

  <section class="section wrap" id="pay">
    <h2>How to pay — x402 in four moves</h2>
    <p class="hint">x402 v2, <code>exact</code> scheme, USDC as the asset. Any x402 HTTP
      client can pay; the flow below is what every client does under the hood.</p>
    <ol class="steps">
      <li><b>Call the paid endpoint without payment.</b>
        <p>POST <code>/v1/x402/capture</code> or <code>/v1/x402/extract</code>. The server
        answers <code>402 Payment Required</code> with the challenge.</p></li>
      <li><b>Read the challenge.</b>
        <p>Decode the base64 <code>PAYMENT-REQUIRED</code> header (the same JSON is also in
        the body for curl-friendly clients): <code>accepts[]</code> says scheme
        <code>exact</code>, network, USDC asset, amount in atomic units, and the
        <code>payTo</code> wallet; <code>extensions.bazaar</code> carries the CDP Bazaar
        service metadata.</p></li>
      <li><b>Sign a gasless EIP-3009 transfer.</b>
        <p>Sign a <code>transferWithAuthorization</code> (from = your wallet, to =
        <code>payTo</code>, value = amount). You never broadcast a tx and never hold
        ETH for gas — the facilitator submits and settles it on-chain.</p></li>
      <li><b>Retry with the signature.</b>
        <p>Send the same request again with the <code>PAYMENT-SIGNATURE</code> header.
        The facilitator verifies + settles, and you get the artifact.</p></li>
    </ol>
    <h3 class="sub-h">Raw curl</h3>
    <div class="term">${termBar('bash')}<pre><code>${curlFlow}</code></pre></div>
    <h3 class="sub-h">Agents: one wrapper</h3>
    <div class="term">${termBar('agent.ts')}<pre><code>${agentSnippet}</code></pre></div>
    <p class="hint">Free, no-payment entry point for agents that want to sample output
      first: <code>GET /v1/extract/preview?url=…</code> returns a bounded structured
      preview (rate-limited). Full discoverable descriptor:
      <code>GET /v1/x402/service</code>.</p>
  </section>

  <section class="section wrap" id="monitoring">
    <h2>Monitoring — scheduled watches</h2>
    <p class="hint">Point webcap at a URL on a schedule and it re-runs the capture or extract pipeline for
      you: every run is compared against the previous one (screenshot bytes sha256-fingerprinted, or field-by-field
      for structured content) and a webhook fires when something changed. Runs are pre-paid in 100-run packs over
      x402 — the same 402 → sign → retry flow as every paid endpoint.</p>
    <div class="price-grid">
      <div class="price">
        <h3>Capture watch</h3>
        <div class="amount">${esc(captureTopUpPrice)} <small>/ 100 runs</small></div>
        <p>100 scheduled re-captures of a URL. The artifact bytes are fingerprinted with sha256 — any byte
          difference counts as a change (diff summary <code>artifact</code>).</p>
        <span class="tag">100 × ${esc(capturePrice)} — POST /v1/x402/watches/topup</span>
      </div>
      <div class="price">
        <h3>Extract watch</h3>
        <div class="amount">${esc(extractTopUpPrice)} <small>/ 100 runs</small></div>
        <p>100 scheduled re-extractions (title, headings, paragraphs, links, images, markdown — plus optional
          model extraction via a natural-language schema). Field-level diff: the alert lists the changed paths,
          e.g. <code>title, paragraphs[2], links[0]</code>.</p>
        <span class="tag">100 × ${esc(extractPrice)} — POST /v1/x402/watches/topup</span>
      </div>
      <div class="price">
        <h3>Change alerts</h3>
        <div class="amount">$0 <small>/ with any watch</small></div>
        <p>Set <code>webhook</code> (https) at creation: a changed run POSTs
          <code>{watchId, url, mode, changed, diffSummary, artifactUrl|extract, at}</code> to it (3 attempts,
          5s timeout each). The first run is the baseline; a watch with 0 credits is paused until a top-up.</p>
        <span class="tag">your https endpoint</span>
      </div>
    </div>
    <h3 class="sub-h">How it works</h3>
    <ol class="steps">
      <li><b>Create the watch (free).</b>
        <p>POST <code>/v1/watches</code> with
        <code>{"url":"https://…","every":"1h","mode":"extract","schema":"…","webhook":"https://…"}</code> —
        <code>every</code> is <code>15m</code>, <code>1h</code>, <code>6h</code> or <code>24h</code>. The first
        run is due on the next scheduler tick.</p></li>
      <li><b>Top up a 100-run pack (x402).</b>
        <p>POST <code>/v1/x402/watches/topup?watchId=…</code> with
        <code>{"watchId":"…","runs":100}</code> — the 402 challenge prices the pack at the watch mode
        (${esc(captureTopUpPrice)} capture / ${esc(extractTopUpPrice)} extract). Pay like every other endpoint
        with the PAYMENT-SIGNATURE header; the watch resumes and its next run is rescheduled.</p></li>
      <li><b>Runs + change alerts.</b>
        <p>Each run consumes 1 credit (ok or error); GET <code>/v1/watches/:id</code> shows the state and the
        last ~10 runs. A changed run replaces the baseline and POSTs the alert to your webhook; a run with 0
        credits is recorded as <code>no-credit</code> and pauses the watch until the next top-up.</p></li>
    </ol>
  </section>

  <section class="section wrap" id="links">
    <h2>Where to find webcap</h2>
    <div class="link-strip">
      <a href="${BAZAAR_CATALOG_URL}" target="_blank" rel="noopener">CDP Bazaar listing ↗</a>
      <a href="/openapi.json">/openapi.json — OpenAPI 3.1 catalog</a>
      <a href="/icon.png">/icon.png — service icon</a>
      <a href="#pricing">Pricing</a>
    </div>
  </section>
</main>
${footer()}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// GET /v1/artifacts/:id/page — shareable artifact page
// ---------------------------------------------------------------------------

export function artifactPageHtml(config: WebcapConfig, artifact: ArtifactRow): string {
  const sourceUrl = artifact.source_url;
  // Artifacts store no public URL column; the canonical URL is the one
  // capture responses return (built from publicBaseUrl, cf. storeArtifact).
  const publicUrl = `${config.publicBaseUrl}/v1/artifacts/${artifact.id}`;
  const title = `Capture of ${sourceUrl} — webcap`;
  const description = `Screenshot of ${sourceUrl} captured by webcap — the pay-per-call web capture API (PNG/JPEG/PDF + OG metadata, USDC over x402).`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(publicUrl)}">
<meta property="og:image" content="${esc(publicUrl)}">
<link rel="icon" href="/icon.png">
<style>${BASE_CSS}${ARTIFACT_CSS}</style>
</head>
<body>
${topBar()}
<main class="wrap artifact-main">
  <p class="crumb"><a href="/">webcap</a> / capture / <code>${esc(artifact.id)}</code></p>
  <h1>Capture of <a href="${esc(sourceUrl)}" target="_blank" rel="noopener">${esc(sourceUrl)}</a></h1>
  <figure class="frame">
    <img src="${esc(publicUrl)}" alt="Screenshot of ${esc(sourceUrl)}" width="1200">
  </figure>
  <dl class="meta">
    <div><dt>format</dt><dd>${esc(artifact.format)}</dd></div>
    <div><dt>size</dt><dd>${formatBytes(artifact.bytes.length)}</dd></div>
    <div><dt>captured</dt><dd>${esc(readableCapturedAt(artifact.created_at))}</dd></div>
  </dl>
  <p class="get"><a href="${esc(publicUrl)}">Download raw ${esc(artifact.format)}</a>
    &nbsp;·&nbsp; <a href="/">← back to webcap</a></p>
</main>
${footer()}
</body>
</html>`;
}
