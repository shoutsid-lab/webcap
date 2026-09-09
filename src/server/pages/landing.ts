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
<title>webcap \u2014 web capture API · screenshots · extraction · monitoring</title>
<meta name="description" content="Developer API for screenshot capture (PNG/JPEG/PDF), structured extraction (title-to-markdown), and change monitoring with webhook alerts. Pay per call, no accounts needed.">
<!-- Open Graph / Facebook -->
<meta property="og:type" content="website">
<meta property="og:url" content="${base}">
<meta property="og:title" content="webcap \u2014 web capture API · screenshots · extraction · monitoring">
<meta property="og:description" content="Screenshot any URL. Extract structured data. Monitor for changes. Developer API with pay-per-call pricing \u2014 no API keys, no accounts.">
<meta property="og:image" content="${base}/icon.png">
<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="webcap \u2014 web capture API · screenshots · extraction · monitoring">
<meta name="twitter:description" content="Screenshot any URL. Extract structured data. Monitor for changes. Developer API with pay-per-call pricing \u2014 no API keys, no accounts.">
<meta name="twitter:image" content="${base}/icon.png">
<link rel="canonical" href="${base}">
<link rel="icon" href="/icon.png">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebAPI",
  "name": "webcap",
  "description": "Web capture API: screenshot any URL as PNG/JPEG/PDF, extract structured data (title, headings, links, markdown), and monitor for changes with webhook alerts. Pay per call, no accounts needed.",
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
  navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'landing_view',meta:{referrer:document.referrer||'direct'}})],{type:'application/json'}));
}catch(ex){}
</script>
${topBar(bazaarCatalogUrl)}
<main>
  <section class="hero wrap">
    <div class="hero-inner">
      <div>
        <p class="kicker"><span class="rec">\u25CF</span> ${copy.kicker}</p>
        <h1>Screenshot any URL. <span class="hl">Extract data. Monitor changes.</span></h1>
        <p class="lede">${copy.lede}</p>
        <div class="cta-row">
          <a class="btn" href="#preview">Try it free \u2193</a>
          <a class="btn ghost" href="#pricing">Pricing</a>
          <a class="btn ghost" href="#pay">How to pay</a>
        </div>
        <div class="hero-badges">
          <span>\u{1F4F7} PNG/JPEG/PDF</span>
          <span>\u{1F4CA} Structured JSON</span>
          <span>\u{1F514} Webhook alerts</span>
          <span>\u{26A1} Pay per call</span>
        </div>
        <div class="social-proof" id="social-proof"><span class="proof-icon">\u2713</span> Pay per call \u00B7 No accounts \u00B7 Developer API</div>
        <div class="preview-cta" id="preview">
          <p class="preview-title">Try it free \u2014 instant preview, zero setup</p>
          <p class="preview-desc">Paste any URL and see what webcap extracts. Free preview is truncated \u2014 full data is $0.01 via x402.</p>
          <form class="preview-form" id="preview-form">
            <div class="url-row">
              <input type="url" id="preview-url-input" name="url" inputmode="url" autocomplete="url"
                value="https://news.ycombinator.com/" placeholder="https://example.com/" required aria-label="URL to preview">
              <button class="btn" type="submit" id="preview-btn">Extract \u2197</button>
            </div>
            <p class="form-note">Results appear below. Full extract: $0.01/batch via x402. <a href="/og-debugger">OG debugger</a> for meta tags.</p>
          </form>
          <div id="preview-results" class="preview-results" hidden></div>
        </div>
        <script>
        (function(){
          /* --- social proof: fetch live metrics and update badge --- */
          fetch('/v1/status').then(function(r){return r.json();}).then(function(s){
            var el=document.getElementById('social-proof');
            if(!el)return;
            var captures=0,extracts=0,audits=0,analyses=0;
            if(s.endpoints&&s.endpoints.topHits){
              s.endpoints.topHits.forEach(function(e){
                if(e.endpoint&&e.endpoint.indexOf('/capture')!==-1)captures+=e.hits;
                if(e.endpoint&&e.endpoint.indexOf('/extract')!==-1)extracts+=e.hits;
                if(e.endpoint&&e.endpoint.indexOf('/audit')!==-1)audits+=e.hits;
                if(e.endpoint&&e.endpoint.indexOf('/analyze')!==-1)analyses+=e.hits;
              });
            }
            var parts=['Developer API'];
            if(captures>0)parts.push(captures.toLocaleString()+' captures served');
            if(extracts>0)parts.push(extracts.toLocaleString()+' extracts completed');
            if(audits>0)parts.push(audits.toLocaleString()+' audits run');
            if(analyses>0)parts.push(analyses.toLocaleString()+' analyses run');
            if(s.artifacts&&s.artifacts.count>0)parts.push(s.artifacts.count.toLocaleString()+' artifacts stored');
            parts.push('No API keys');
            parts.push('No accounts');
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
            try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'preview_submit',meta:{url:url}})],{type:'application/json'}));}catch(ex){}
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
                try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'preview_result_success',meta:{url:url,wordCount:p.wordCount||0,headingCount:(p.headings||[]).length,linkCount:(p.links||[]).length}})],{type:'application/json'}));}catch(ex){}
                var upgradeLink=results?results.querySelector('.pr-upgrade-link'):null;
                if(upgradeLink)upgradeLink.addEventListener('click',function(){try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'preview_upgrade_click',meta:{url:url}})],{type:'application/json'}));}catch(ex){}});
              })
              .catch(function(err){
                if(results)results.innerHTML='<div class="pr-error">Preview failed: '+esc(String(err))+' <a href="${base}/v1/extract/preview?url='+encodeURIComponent(url)+'" target="_blank">Open raw JSON \u2197</a></div>';
                try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'preview_result_error',meta:{url:url,error:esc(String(err))}})],{type:'application/json'}));}catch(ex){}
              })
              .finally(function(){
                if(btn){btn.disabled=false;btn.textContent='Try it now \u2197';}
              });
          });
          function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
          /* --- CTA click tracking --- */
          document.querySelectorAll('.btn').forEach(function(btn){
            btn.addEventListener('click',function(){
              try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'cta_click',meta:{text:btn.textContent||'',href:btn.getAttribute('href')||''}})],{type:'application/json'}));}catch(ex){}
            });
          });
          /* --- waitlist form --- */
          var wlForm=document.getElementById('waitlist-form');
          if(wlForm){
            wlForm.addEventListener('submit',function(e){
              e.preventDefault();
              var emailInput=document.getElementById('waitlist-email');
              var btn=document.getElementById('waitlist-btn');
              var note=document.getElementById('waitlist-note');
              var email=emailInput?emailInput.value.trim():'';
              if(!email||!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email))return;
              if(btn){btn.disabled=true;btn.textContent='Joining...';}
              fetch('/v1/waitlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email})})
                .then(function(r){return r.json();})
                .then(function(d){
                  if(note){note.hidden=false;note.textContent='Thanks! You\\'re on the list.';note.className='waitlist-note success';}
                  if(emailInput)emailInput.value='';
                  try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'waitlist_signup',meta:{email:email}})],{type:'application/json'}));}catch(ex){}
                })
                .catch(function(err){
                  if(note){note.hidden=false;note.textContent='Something went wrong. Try again.';note.className='waitlist-note error';}
                })
                .finally(function(){
                  if(btn){btn.disabled=false;btn.textContent='Join waitlist';}
                });
            });
          }
        })();
        </script>
      </div>
      <div class="term" aria-label="curl example of the x402 payment flow">
        ${termBar('402 \u2192 PAYMENT-REQUIRED \u2192 sign \u2192 retry')}
        <pre><code>${curlFlow}</code></pre>
      </div>
    </div>
  </section>

  <section class="section wrap" id="waitlist">
    <div class="waitlist-card">
      <div class="waitlist-content">
        <h3>Stay updated</h3>
        <p>Get notified about new features, pricing changes, and API updates. No spam.</p>
      </div>
      <form class="waitlist-form" id="waitlist-form">
        <div class="waitlist-row">
          <input type="email" id="waitlist-email" name="email" placeholder="you@example.com" required aria-label="Email address">
          <button class="btn" type="submit" id="waitlist-btn">Join waitlist</button>
        </div>
        <p class="waitlist-note" id="waitlist-note" hidden></p>
      </form>
    </div>
  </section>

  <section class="section wrap" id="pricing">
    <p class="eyebrow">Pricing</p>
    <h2>Pay per call. No accounts.</h2>
    <p class="hint">Flat per-call prices. Compute costs are covered by us \u2014 you pay only
      for the capture, ${copy.settlement}. Pay with card (Stripe) or crypto (x402 USDC).</p>
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

  <section class="section wrap" id="monitoring">
    <p class="eyebrow">Monitoring</p>
    <h2>Change monitoring with webhook alerts</h2>
    <p class="hint">Point webcap at a URL on a schedule and it re-runs the capture or extract pipeline for
      you: every run is compared against the previous one (screenshot bytes sha256-fingerprinted, or field-by-field
      for structured content) and a webhook fires when something changed. Runs are pre-paid in ${WATCH_TOPUP_RUNS}-run packs.</p>
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
  </section>

  <section class="section wrap" id="pay">
    <p class="eyebrow">How it works</p>
    <h2>Simple API, pay when you use it</h2>
    <p class="hint">webcap uses x402 micropayments \u2014 an open HTTP standard for pay-per-call APIs.
      No API keys, no accounts, no sign-up. You can also pay by card via Stripe.</p>
    <div class="pay-options">
      <div class="pay-option">
        <h3>\u{1F4B3} Pay with card</h3>
        <p>Buy credit packs via Stripe Checkout. Credits are deducted per API call.
          No wallet needed \u2014 just a credit card.</p>
        <span class="tag">POST /v1/stripe/checkout</span>
      </div>
      <div class="pay-option">
        <h3>\u{1F4E8} Pay with crypto</h3>
        <p>Each call returns HTTP 402 with a USDC payment challenge.
          Sign a gasless EIP-3009 transfer and retry \u2014 no ETH needed for gas.</p>
        <span class="tag">x402 v2 on Base</span>
      </div>
    </div>
    <ol class="steps">
      <li><b>Call the endpoint.</b>
        <p>POST <code>/v1/x402/capture</code> or <code>/v1/x402/extract</code>. The server
        answers <code>402 Payment Required</code> with a payment challenge.</p></li>
      <li><b>Sign the payment.</b>
        <p>Sign a gasless EIP-3009 <code>transferWithAuthorization</code> with your wallet.
        No ETH required for gas \u2014 the facilitator submits and settles it on-chain.</p></li>
      <li><b>Get your result.</b>
        <p>Retry with the <code>PAYMENT-SIGNATURE</code> header. The facilitator verifies
        and settles, and you get the artifact.</p></li>
    </ol>
    <p class="hint">Free preview endpoint for testing: <code>GET /v1/extract/preview?url=\u2026</code>
      returns structured data (rate-limited, truncated). Full API spec:
      <code><a href="/openapi.json">GET /v1/x402/service</a></code>.</p>
    <div class="term">${termBar('bash — quick start')}<pre><code><span class="c"># Free preview \u2014 no payment needed</span>
curl "${base}/v1/extract/preview?url=https://example.com/"

<span class="c"># Paid capture \u2014 returns 402, sign, retry</span>
curl -si -X POST "${base}/v1/x402/capture" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"url":"https://example.com/"}'</span>

<span class="c"># Paid extract \u2014 structured JSON from any URL</span>
curl -si -X POST "${base}/v1/x402/extract" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -H <span class="s">'PAYMENT-SIGNATURE: &lt;signed payload&gt;'</span> \\
  -d <span class="s">'{"urls":["https://example.com/"]}'</span></code></pre></div>
  </section>

  <section class="section wrap" id="crypto" class="secondary">
    <p class="eyebrow">Payment methods</p>
    <h2>Pay with card or crypto</h2>
    <p class="hint">Choose the method that works for you: <strong>Stripe</strong> for card payments
      (credit packs added to your account), or <strong>USDC on Base</strong> via x402 micropayments
      (gasless, no ETH needed). No API keys, no accounts, no sign-up.</p>
  </section>

  <section class="section wrap" id="links">
    <p class="eyebrow">Resources</p>
    <h2>Where to find webcap</h2>
    <div class="link-strip">
      <a href="${bazaarCatalogUrl}" target="_blank" rel="noopener">CDP Bazaar listing <span class="arr">\u2197</span></a>
      <a href="/openapi.json">/openapi.json \u2014 OpenAPI 3.1 catalog <span class="arr">\u2192</span></a>
      <a href="/icon.png">/icon.png \u2014 service icon <span class="arr">\u2192</span></a>
      <a href="/og-debugger">/og-debugger \u2014 free OG meta debugger <span class="arr">\u2192</span></a>
      <a href="/compare">/compare \u2014 webcap vs alternatives <span class="arr">\u2192</span></a>
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
<div class="sticky-cta" id="sticky-cta">
  <a class="btn" href="#preview" id="sticky-cta-btn">Try it now — extract any URL for free</a>
</div>
<script>
(function(){
  var sticky=document.getElementById('sticky-cta');
  var form=document.getElementById('preview');
  if(!sticky||!form)return;
  function checkVisibility(){
    var rect=form.getBoundingClientRect();
    if(rect.top<window.innerHeight&&rect.bottom>0){
      sticky.style.transform='translateY(100%)';
      sticky.style.transition='transform .3s ease';
    }else{
      sticky.style.transform='translateY(0)';
    }
  }
  window.addEventListener('scroll',checkVisibility,{passive:true});
  checkVisibility();
})();
</script>
</body>
</html>`;
}
