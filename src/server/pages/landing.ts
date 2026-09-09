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
  const videoPrice = usd(config.x402VideoPriceUsdcUnits);
  const analyzePrice = '$0.01'; // hardcoded in ml-routes.ts as 10_000 atomic units
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
<!-- Open Graph / Facebook -->
<meta property="og:type" content="website">
<meta property="og:url" content="${base}">
<meta property="og:title" content="webcap \u2014 pay-per-call web capture API (x402 USDC)">
<meta property="og:description" content="Screenshot any URL. Pay per call, on-chain. PNG/JPEG/PDF capture, structured extraction, and scheduled monitoring with change alerts. ${copy.settlement}.">
<meta property="og:image" content="${base}/icon.png">
<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="webcap \u2014 pay-per-call web capture API (x402 USDC)">
<meta name="twitter:description" content="Screenshot any URL. Pay per call, on-chain. PNG/JPEG/PDF capture, structured extraction, and scheduled monitoring with change alerts. ${copy.settlement}.">
<meta name="twitter:image" content="${base}/icon.png">
<link rel="canonical" href="${base}">
<link rel="icon" href="/icon.png">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebAPI",
  "name": "webcap",
  "description": "Pay-per-call web capture API: screenshots (PNG/JPEG/PDF), structured extraction, and scheduled monitoring with change alerts. x402 USDC micropayments ${copy.settlement}.",
  "url": "${base}",
  "documentation": "${base}/openapi.json",
  "provider": {
    "@type": "Organization",
    "name": "webcap"
  },
  "offers": [
    {
      "@type": "Offer",
      "name": "Capture",
      "description": "Screenshot as PNG/JPEG/PDF + free OG metadata",
      "price": "0.001",
      "priceCurrency": "USD"
    },
    {
      "@type": "Offer",
      "name": "Extract",
      "description": "Structured text/JSON extraction from URLs",
      "price": "0.01",
      "priceCurrency": "USD"
    },
    {
      "@type": "Offer",
      "name": "Audit",
      "description": "SEO basics + link/OG health check",
      "price": "0.002",
      "priceCurrency": "USD"
    }
  ]
}
</script>
<style>${BASE_CSS}${LANDING_CSS}</style>
</head>
<body>
<script>
// Track landing page view
try{
  navigator.sendBeacon('/v1/track',JSON.stringify({event:'landing_view',meta:{referrer:document.referrer||'direct'}}));
}catch(ex){}
</script>
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
        <div class="social-proof" id="social-proof"><span class="proof-icon">\u2713</span> Pay per call \u00B7 No accounts \u00B7 x402 USDC</div>
        <div class="preview-cta">
          <p class="preview-title">Try it free \u2014 no account, no payment</p>
          <p class="preview-desc">See what webcap returns. Want the full data? Pay per call with USDC \u2014 no sign-up required.</p>
          <form class="preview-form" id="preview-form">
            <div class="url-row">
              <input type="url" id="preview-url-input" name="url" inputmode="url" autocomplete="url"
                placeholder="https://example.com/" required aria-label="URL to preview">
              <button class="btn" type="submit" id="preview-btn">Try it now \u2197</button>
            </div>
            <p class="form-note">Results appear inline below. Full extract: $0.01/batch via x402. <a href="/og-debugger">OG debugger</a> for meta tags.</p>
          </form>
          <div id="preview-results" class="preview-results" hidden></div>
        </div>
        <script>
        (function(){
          /* --- social proof: fetch live metrics and update badge --- */
          fetch('/v1/status').then(function(r){return r.json();}).then(function(s){
            var el=document.getElementById('social-proof');
            if(!el)return;
            var parts=[];
            parts.push('Pay per call');
            parts.push('No accounts');
            if(s.artifacts&&s.artifacts.count>0)parts.push(s.artifacts.count+' artifacts served');
            if(s.endpoints&&s.endpoints.topHits){
              var total=0;s.endpoints.topHits.forEach(function(e){total+=e.hits;});
              if(total>0)parts.push(total+' API hits');
            }
            parts.push('x402 USDC');
            el.innerHTML='<span class="proof-icon">\u2713</span> '+parts.join(' \u00B7 ');
          }).catch(function(){});
          /* --- preview form --- */
          var form=document.getElementById('preview-form');
          if(!form)return;
          form.addEventListener('submit',function(e){
            e.preventDefault();
            var input=document.getElementById('preview-url-input');
            var btn=document.getElementById('preview-btn');
            var results=document.getElementById('preview-results');
            var url=input?input.value.trim():'';
            if(!url)return;
            if(!/^https?:\\/\\//i.test(url))url='https://'+url;
            try{navigator.sendBeacon('/v1/track',JSON.stringify({event:'preview_submit',meta:{url:url}}));}catch(ex){}
            if(btn){btn.disabled=true;btn.textContent='Loading\u2026';}
            if(results){results.hidden=false;results.innerHTML='<div class="pr-loading"><span class="pr-spinner"></span> Fetching preview\u2026</div>';}
            fetch('${base}/v1/extract/preview?url='+encodeURIComponent(url))
              .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
              .then(function(d){
                var p=d.preview||{};
                var h='';
                h+='<div class="pr-header"><span class="pr-url">'+esc(p.title||url)+'</span>';
                if(d.truncated)h+='<span class="pr-badge">preview</span>';
                h+='</div>';
                if(p.description)h+='<p class="pr-desc">'+esc(p.description)+'</p>';
                if(p.headings&&p.headings.length){
                  h+='<div class="pr-section"><span class="pr-label">Headings</span><ul>';
                  p.headings.slice(0,8).forEach(function(heading){h+='<li><span class="pr-h'+heading.level+'">H'+heading.level+'</span> '+esc(heading.text)+'</li>';});
                  h+='</ul></div>';
                }
                if(p.links&&p.links.length){
                  h+='<div class="pr-section"><span class="pr-label">Links ('+p.links.length+')</span>';
                  h+='<div class="pr-links">';
                  p.links.slice(0,6).forEach(function(link){h+='<a href="'+esc(link.href)+'" target="_blank" rel="noopener">'+esc(link.text||link.href)+'</a>';});
                  if(p.links.length>6)h+='<span class="pr-more">+'+(p.links.length-6)+' more</span>';
                  h+='</div></div>';
                }
                if(p.wordCount)h+='<div class="pr-section"><span class="pr-label">Words</span> '+p.wordCount+'</div>';
                h+='<div class="pr-upgrade"><span class="pr-upgrade-icon">\u2191</span> Free preview is truncated. <a href="#pay" class="pr-upgrade-link">Full extract: $0.01/batch</a> via x402 USDC \u2014 no sign-up.</div>';
                if(results)results.innerHTML=h;
                try{navigator.sendBeacon('/v1/track',JSON.stringify({event:'preview_result_success',meta:{url:url,wordCount:p.wordCount||0,headingCount:(p.headings||[]).length,linkCount:(p.links||[]).length}}));}catch(ex){}
                var upgradeLink=results?results.querySelector('.pr-upgrade-link'):null;
                if(upgradeLink)upgradeLink.addEventListener('click',function(){try{navigator.sendBeacon('/v1/track',JSON.stringify({event:'preview_upgrade_click',meta:{url:url}}));}catch(ex){}});
              })
              .catch(function(err){
                if(results)results.innerHTML='<div class="pr-error">Preview failed: '+esc(String(err))+' <a href="${base}/v1/extract/preview?url='+encodeURIComponent(url)+'" target="_blank">Open raw JSON \u2197</a></div>';
                try{navigator.sendBeacon('/v1/track',JSON.stringify({event:'preview_result_error',meta:{url:url,error:esc(String(err))}}));}catch(ex){}
              })
              .finally(function(){
                if(btn){btn.disabled=false;btn.textContent='Try it now \u2197';}
              });
          });
          function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
          /* --- CTA click tracking --- */
          document.querySelectorAll('.btn').forEach(function(btn){
            btn.addEventListener('click',function(){
              try{navigator.sendBeacon('/v1/track',JSON.stringify({event:'cta_click',meta:{text:btn.textContent||'',href:btn.getAttribute('href')||''}}));}catch(ex){}
            });
          });
        })();
        </script>
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
        <h3>Video</h3>
        <div class="amount">${esc(videoPrice)} <small>/ URL</small></div>
        <p>Scroll-capture any URL as an MP4 or WebM video. Records the full page
          scroll with configurable duration and easing. Ideal for demos, archiving,
          or visual regression feeds.</p>
        <span class="tag">POST /v1/x402/video</span>
      </div>
      <div class="price">
        <h3>Analyze</h3>
        <div class="amount">${esc(analyzePrice)} <small>/ URL</small></div>
        <p>AI-powered visual analysis of a screenshot: classification, accessibility
          audit, layout analysis, entity extraction, sentiment. One payment per
          analysis; batch endpoint available.</p>
        <span class="tag">POST /v1/x402/analyze</span>
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
    <p class="hint">Also available: <code>POST /v1/x402/audit</code> \u2014 SEO basics + link/OG health in one call for ${esc(auditPrice)} per URL.</p>
  </section>

  <section class="section wrap" id="crypto">
    <p class="eyebrow">New to crypto?</p>
    <h2>Get started in 3 steps</h2>
    <p class="hint">webcap uses USDC on Base via x402 micropayments. No API keys, no accounts.
      If you have USDC on Base, you can pay. If not, here's how to get set up:</p>
    <ol class="steps">
      <li><b>Get USDC on Base</b>
        <p>Use a bridge or on-ramp to get USDC on the Base network. Most wallets
        (Coinbase Wallet, MetaMask, etc.) support Base. You only need a few dollars
        \u2014 each capture is just ${esc(capturePrice)}.</p></li>
      <li><b>Connect your wallet</b>
        <p>No account needed \u2014 webcap uses your existing wallet. The payment
        flow is gasless: you sign a message, the facilitator submits the tx.
        No ETH required for gas.</p></li>
      <li><b>Sign and pay</b>
        <p>When you call a paid endpoint, webcap returns a 402 with a payment
        challenge. Sign it with your wallet and retry \u2014 the facilitator settles
        on-chain and you get the result.</p></li>
    </ol>
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
