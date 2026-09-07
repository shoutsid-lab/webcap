/**
 * GET / — the product landing page. Renders the chain-conditional copy
 * (./copy.ts) over the shared CSS (./css.ts) + landing primitives, with the
 * x402 payment flow as copy-paste curl + agent snippets. Split out of pages.ts
 * as a pure move (no behavior change) — the served HTML is byte-identical.
 */
import { DEFAULT_BAZAAR_CATALOG_URL, USDC_SCALE, WATCH_TOPUP_RUNS, watchTopUpPriceUsdcUnits, type WebcapConfig } from '../../config.js';
import { footer, topBar } from './chrome.js';
import { BASE_CSS, LANDING_CSS } from './css.js';
import { CHAIN_COPY } from './copy.js';
import { esc } from './format.js';

/** Atomic 6-decimal USDC units -> "$0.001" (shortest decimal rendering). */
function usd(atomicUnits: number): string {
  return `$${atomicUnits / USDC_SCALE}`;
}

const termBar = (label: string): string =>
  `<div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">${esc(label)}</span></div>`;

export function landingHtml(config: WebcapConfig): string {
  const base = config.publicBaseUrl;
  const bazaarCatalogUrl = config.bazaarCatalogUrl ?? DEFAULT_BAZAAR_CATALOG_URL;
  const copy = CHAIN_COPY[config.chain.name];
  // Network shown in the copy-paste examples; local has no x402 network, so
  // the samples demonstrate the sepolia testnet (matching the local note).
  const network = config.x402Network ?? 'eip155:84532';
  const capturePrice = usd(config.x402PriceUsdcUnits);
  const extractPrice = usd(config.x402ExtractPriceUsdcUnits);
  const auditPrice = usd(config.x402AuditPriceUsdcUnits);
  // WATCH_TOPUP_RUNS-run top-up packs (the monitoring prices), always two-decimal.
  const topUpUsd = (usdcUnits: number): string => `$${(usdcUnits / USDC_SCALE).toFixed(2)}`;
  const captureTopUpPrice = topUpUsd(watchTopUpPriceUsdcUnits('capture', config));
  const extractTopUpPrice = topUpUsd(watchTopUpPriceUsdcUnits('extract', config));

  const curlFlow = `<span class="c"># 1) POST without payment \u2014 you get HTTP 402 + a PAYMENT-REQUIRED</span>
<span class="c">#    response header: a base64-encoded JSON challenge</span>
curl -si -X POST "${base}/v1/x402/capture" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"url":"https://example.com/"}'</span>

<span class="c">#    decode the challenge:</span>
<span class="k">PAYMENT-REQUIRED:</span> &lt;base64&gt;
base64 -d &lt;&lt;&lt; <span class="s">'$PAYMENT_REQUIRED'</span>
<span class="c">#  \u2192 {"x402Version":2,"error":"Payment required",</span>
<span class="c">#     "accepts":[{"scheme":"exact","network":"${network}","asset":"0x\u2026USDC",</span>
<span class="c">#                 "amount":"${config.x402PriceUsdcUnits}","payTo":"0x\u2026","maxTimeoutSeconds":300,</span>
<span class="c">#                 "extra":{"name":"USDC","version":"2"}],</span>
<span class="c">#     "resource":{\u2026}, "extensions":{"bazaar":{\u2026}}}</span>

<span class="c"># 2) Sign a gasless EIP-3009 transferWithAuthorization:</span>
<span class="c">#    from = your wallet, to = payTo, value = amount (6-decimal USDC).</span>
<span class="c">#    The facilitator submits the tx and pays gas \u2014 no ETH needed.</span>

<span class="c"># 3) Retry with the signature \u2014 the facilitator verifies + settles on-chain</span>
curl -s -X POST "${base}/v1/x402/capture" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -H <span class="s">'PAYMENT-SIGNATURE: &lt;base64 payment payload&gt;'</span> \\
  -d <span class="s">'{"url":"https://example.com/"}'</span>
<span class="ok">\u2192 200</span> {"artifact":{"format":"png","bytes":\u2026,"data":"&lt;base64&gt;","url":"\u2026/v1/artifacts/&lt;id&gt;"},
        "payment":{"payer":"0x\u2026","priceUsdcUnits":${config.x402PriceUsdcUnits}}}`;

  const agentSnippet = `<span class="c">// any x402 v2 HTTP client works \u2014 example with @x402/axios:</span>
<span class="c">// ${copy.snippetNote}</span>
import axios from 'axios';
import { x402Client, wrapAxiosWithPayment } from '@x402/axios';
import { ExactEvmScheme } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.PAYER_PRIVATE_KEY);
const client = new x402Client().register('${network}', new ExactEvmScheme(account));

<span class="c">// the wrapper handles 402 \u2192 sign PAYMENT-SIGNATURE \u2192 retry automatically</span>
const api = wrapAxiosWithPayment(axios.create({ baseURL: '${base}' }), client);
const res = await api.post('/v1/x402/capture', { url: 'https://example.com/' });
console.log(res.data.artifact.url); <span class="c">// 200 \u2014 paid, settled, screenshot served</span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>webcap \u2014 pay-per-call web capture API (x402 USDC)</title>
<meta name="description" content="webcap turns any URL into a PNG/JPEG/PDF screenshot + Open Graph metadata, or structured text/JSON from batch extraction. Pay per call in USDC over x402 micropayments \u2014 no API keys, no accounts, gasless.">
<link rel="icon" href="/icon.png">
<style>${BASE_CSS}${LANDING_CSS}</style>
</head>
<body>
${topBar(bazaarCatalogUrl)}
<main>
  <section class="hero wrap">
    <div class="hero-inner">
      <div>
        <p class="kicker"><span class="rec">\u25CF</span> ${copy.kicker}</p>
        <h1>Screenshot any URL. <span class="hl">Pay per call, on-chain.</span></h1>
        <p class="lede">${copy.lede} The full suite in one service:
          <strong>one-time capture</strong> (PNG / JPEG / PDF screenshot; Open Graph
          metadata via <code>GET /v1/og</code>), <strong>structured extraction</strong> (title, headings, paragraphs,
          links, images, document-order markdown), and <strong>scheduled monitoring with
          change alerts</strong> (${WATCH_TOPUP_RUNS}-run pre-paid packs, webhook diff on change).</p>
        <div class="cta-row">
          <a class="btn" href="#pay">How to pay</a>
          <a class="btn ghost" href="/openapi.json">OpenAPI spec</a>
        </div>
        <p class="micro">Free preview, no payment: <a href="/v1/extract/preview?url=https://example.com/">Try it \u2014 <code>GET /v1/extract/preview?url=\u2026</code></a> (rate-limited)</p>
        <div class="hero-badges" aria-label="capabilities"><span>PNG \u00B7 JPEG \u00B7 PDF</span><span>GET /v1/og</span><span>x402 USDC</span></div>
      </div>
      <div class="term" aria-label="curl example of the x402 payment flow">
        ${termBar('402 \u2192 PAYMENT-REQUIRED \u2192 sign \u2192 retry')}
        <pre><code>${curlFlow}</code></pre>
      </div>
    </div>
  </section>

  <section class="section wrap" id="pricing">
    <p class="eyebrow">Pricing</p>
    <h2>Pricing</h2>
    <p class="hint">Flat per-call prices. Compute costs are covered by us \u2014 you pay only
      for the capture, ${copy.settlement}.</p>
    <div class="price-grid">
      <div class="price">
        <h3>Capture</h3>
        <div class="amount">${esc(capturePrice)} <small>/ URL</small></div>
        <p>PNG, JPEG or PDF screenshot of any public URL. Open Graph metadata is a
          separate free endpoint: <code>GET /v1/og</code>. The artifact is stored and
          served at <code>/v1/artifacts/&lt;id&gt;</code> with a shareable page.</p>
        <span class="tag">POST /v1/x402/capture</span>
      </div>
      <div class="price featured">
        <span class="flag">Most popular</span>
        <h3>Extract</h3>
        <div class="amount">${esc(extractPrice)} <small>/ URL batch</small></div>
        <p>Structured text/JSON \u2014 title, description, headings, paragraphs, links,
          images, word count, clean markdown. Batch up to 50 URLs for one payment;
          optional model extraction via a natural-language schema.</p>
        <span class="tag">POST /v1/x402/extract</span>
      </div>
      <div class="price">
        <h3>Compute</h3>
        <div class="amount">$0 <small>/ covered</small></div>
        <p>Browser rendering, page loads and storage are on us \u2014 amortized compute
          cost is already inside the per-call price. No minimums, no markup, no
          credit packs required for x402 calls.</p>
        <span class="tag">covered by webcap</span>
      </div>
    </div>
    <p class="hint">New: <code>POST /v1/x402/audit</code> \u2014 SEO basics + link/OG health in one call for ${esc(auditPrice)} per URL.</p>
  </section>

  <section class="section wrap" id="pay">
    <p class="eyebrow">Payment flow</p>
    <h2>How to pay \u2014 x402 in four moves</h2>
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
        ETH for gas \u2014 the facilitator submits and settles it on-chain.</p></li>
      <li><b>Retry with the signature.</b>
        <p>Send the same request again with the <code>PAYMENT-SIGNATURE</code> header.
        The facilitator verifies + settles, and you get the artifact.</p></li>
    </ol>
    <h3 class="sub-h">Raw curl</h3>
    <div class="term">${termBar('bash')}<pre><code>${curlFlow}</code></pre></div>
    <h3 class="sub-h">Agents: one wrapper</h3>
    <div class="term">${termBar('agent.ts')}<pre><code>${agentSnippet}</code></pre></div>
    <p class="hint">Free, no-payment entry point for agents that want to sample output
      first: <code>GET /v1/extract/preview?url=\u2026</code> returns a bounded structured
      preview (rate-limited). Full discoverable descriptor:
      <code>GET /v1/x402/service</code>.</p>
  </section>

  <section class="section wrap" id="monitoring">
    <p class="eyebrow">Monitoring</p>
    <h2>Monitoring \u2014 scheduled watches</h2>
    <p class="hint">Point webcap at a URL on a schedule and it re-runs the capture or extract pipeline for
      you: every run is compared against the previous one (screenshot bytes sha256-fingerprinted, or field-by-field
      for structured content) and a webhook fires when something changed. Runs are pre-paid in ${WATCH_TOPUP_RUNS}-run packs over
      x402 \u2014 the same 402 \u2192 sign \u2192 retry flow as every paid endpoint.</p>
    <div class="price-grid">
      <div class="price">
        <h3>Capture watch</h3>
        <div class="amount">${esc(captureTopUpPrice)} <small>/ ${WATCH_TOPUP_RUNS} runs</small></div>
        <p>${WATCH_TOPUP_RUNS} scheduled re-captures of a URL. The artifact bytes are fingerprinted with sha256 \u2014 any byte
          difference counts as a change (diff summary <code>artifact</code>).</p>
        <span class="tag">${WATCH_TOPUP_RUNS} \u00D7 ${esc(capturePrice)} \u2014 POST /v1/x402/watches/topup</span>
      </div>
      <div class="price">
        <h3>Extract watch</h3>
        <div class="amount">${esc(extractTopUpPrice)} <small>/ ${WATCH_TOPUP_RUNS} runs</small></div>
        <p>${WATCH_TOPUP_RUNS} scheduled re-extractions (title, headings, paragraphs, links, images, markdown \u2014 plus optional
          model extraction via a natural-language schema). Field-level diff: the alert lists the changed paths,
          e.g. <code>title, paragraphs[2], links[0]</code>.</p>
        <span class="tag">${WATCH_TOPUP_RUNS} \u00D7 ${esc(extractPrice)} \u2014 POST /v1/x402/watches/topup</span>
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
        <code>{"url":"https://\u2026","every":"1h","mode":"extract","schema":"\u2026","webhook":"https://\u2026"}</code> \u2014
        <code>every</code> is <code>15m</code>, <code>1h</code>, <code>6h</code> or <code>24h</code>. The first
        run is due on the next scheduler tick.</p></li>
       <li><b>Top up a ${WATCH_TOPUP_RUNS}-run pack (x402).</b>
        <p>POST <code>/v1/x402/watches/topup?watchId=\u2026</code> with
        <code>{"watchId":"\u2026","runs":${WATCH_TOPUP_RUNS}}</code> \u2014 the 402 challenge prices the pack at the watch mode
        (${esc(captureTopUpPrice)} capture / ${esc(extractTopUpPrice)} extract). Pay like every other endpoint
        with the PAYMENT-SIGNATURE header; the watch resumes and its next run is rescheduled.</p></li>
      <li><b>Runs + change alerts.</b>
        <p>Each run consumes 1 credit (ok or error); GET <code>/v1/watches/:id</code> shows the state and the
        last ~10 runs. A changed run replaces the baseline and POSTs the alert to your webhook; a run with 0
        credits is recorded as <code>no-credit</code> and pauses the watch until the next top-up.</p></li>
    </ol>
  </section>

  <section class="section wrap" id="links">
    <p class="eyebrow">Resources</p>
    <h2>Where to find webcap</h2>
    <div class="link-strip">
      <a href="${bazaarCatalogUrl}" target="_blank" rel="noopener">CDP Bazaar listing <span class="arr">\u2197</span></a>
      <a href="/openapi.json">/openapi.json \u2014 OpenAPI 3.1 catalog <span class="arr">\u2192</span></a>
      <a href="/icon.png">/icon.png \u2014 service icon <span class="arr">\u2192</span></a>
      <a href="/og-debugger">/og-debugger \u2014 free OG meta debugger <span class="arr">\u2192</span></a>
      <a href="#pricing">Pricing <span class="arr">\u2192</span></a>
    </div>
    <p class="hint">Independently observed trust (third-party index, live-probed \u2014 not a guarantee):</p>
    <div class="trust-strip">
      <a href="https://5.75.142.199.sslip.io/x402/trust/46929" target="_blank" rel="noopener"><img src="https://5.75.142.199.sslip.io/badge/x402/46929.svg" alt="x402 trust badge: capture route" loading="lazy"></a>
      <a href="https://5.75.142.199.sslip.io/x402/trust/46928" target="_blank" rel="noopener"><img src="https://5.75.142.199.sslip.io/badge/x402/46928.svg" alt="x402 trust badge: extract route" loading="lazy"></a>
    </div>
  </section>
</main>
${footer(bazaarCatalogUrl)}
</body>
</html>`;
}
