/**
 * GET / — the product landing page. Redesigned for conversion: ONE clear
 * value proposition, ONE CTA, proper section order following SaaS best practices.
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
  const network = config.x402Network ?? 'eip155:84532';
  const capturePrice = usd(config.x402PriceUsdcUnits);
  const extractPrice = usd(config.x402ExtractPriceUsdcUnits);
  const auditPrice = usd(config.x402AuditPriceUsdcUnits);
  const videoPrice = usd(config.x402VideoPriceUsdcUnits);
  const analyzePrice = '$0.01';
  const topUpUsd = (usdcUnits: number): string => `$${(usdcUnits / USDC_SCALE).toFixed(2)}`;
  const captureTopUpPrice = topUpUsd(watchTopUpPriceUsdcUnits('capture', config));
  const extractTopUpPrice = topUpUsd(watchTopUpPriceUsdcUnits('extract', config));
  const stripeConfigured = !!config.stripeSecretKey;

  const curlFlow = `<span class="c"># Capture any URL as PNG, JPEG, or PDF</span>
curl -X POST "${base}/v1/x402/capture" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"url":"https://example.com/"}'</span>
<span class="ok">\u2192 200</span> {"artifact":{"format":"png","bytes":48291}}

<span class="c"># Extract structured data \u2014 title, headings, links, markdown</span>
curl -X POST "${base}/v1/x402/extract" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"urls":["https://example.com/"]}'</span>
<span class="ok">\u2192 200</span> {"results":[{"url":"https://example.com/",
      "title":"Example Domain","markdown":"# Example Domain\\n..."}]}

<span class="c"># Free preview \u2014 no payment needed</span>
curl "${base}/v1/extract/preview?url=https://example.com/"
<span class="ok">\u2192 200</span> {"title":"Example Domain","wordCount":123}
<div class="term-note"><span class="c">How to pay:</span> x402 micropayments (USDC) or Stripe. Free preview: <code>${base}/v1/extract/preview?url=...</code></div>`;

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
    }
  ]
}
</script>
<style>${BASE_CSS}${LANDING_CSS}</style>
</head>
<body>
<script>
try{
  navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'landing_view',meta:{referrer:document.referrer||'direct'}})],{type:'application/json'}));
}catch(ex){}
</script>
${topBar(bazaarCatalogUrl, 'landing')}

<!-- ═══════════════════════════════════════════════════════════════
     HERO: ONE outcome, ONE CTA, ONE screenshot
     ═══════════════════════════════════════════════════════════════ -->
<main>
  <section class="hero wrap">
    <div class="hero-inner">
      <div>
        <p class="kicker"><span class="rec">\u25CF</span> ${copy.kicker}</p>
        <h1>Screenshot any URL.<br><span class="hl">Extract data. Monitor changes.</span></h1>
        <p class="lede">${copy.lede}</p>
        <div class="cta-row">
          <a class="btn" href="#preview">Try it free \u2193</a>
          <a class="btn ghost" href="https://github.com/shoutsid-lab/webcap" target="_blank" rel="noopener">\u{1F4BB} GitHub</a>
          <a class="btn ghost" href="${stripeConfigured ? '/buy' : '#newsletter'}" data-upgrade="hero">Buy credits \u2192</a>
        </div>
        <div class="social-proof" id="social-proof"><span class="proof-icon">\u{1F7E2}</span> <span id="proof-text">Live metrics loading\u2026</span></div>
      </div>
      <div class="term" aria-label="curl example of the webcap API">
        ${termBar('webcap in action \u2014 screenshots, data, monitoring')}
        <pre><code>${curlFlow}</code></pre>
      </div>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       SOCIAL PROOF: Trust signals immediately below fold
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="proof">
    <div class="trust-bar">
      <div class="trust-item">
        <span class="trust-num" id="proof-captures">--</span>
        <span class="trust-label">Captures</span>
      </div>
      <div class="trust-item">
        <span class="trust-num" id="proof-extracts">--</span>
        <span class="trust-label">Extracts</span>
      </div>
      <div class="trust-item">
        <span class="trust-num">No API keys</span>
        <span class="trust-label">Required</span>
      </div>
      <div class="trust-item">
        <span class="trust-num">No accounts</span>
        <span class="trust-label">Needed</span>
      </div>
      <div class="trust-item">
        <span class="trust-num">Pay per call</span>
        <span class="trust-label">Card or crypto</span>
      </div>
      <div class="trust-item">
        <span class="trust-num">993 tests</span>
        <span class="trust-label">passing</span>
      </div>
      <div class="trust-item">
        <span class="trust-num">MIT</span>
        <span class="trust-label">licensed</span>
      </div>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       INTERACTIVE PREVIEW: Try before you buy
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="preview">
    <p class="eyebrow">Try it free</p>
    <h2>Extract any URL instantly</h2>
    <p class="hint">Paste a URL and see what webcap extracts \u2014 title, headings, links, markdown. Free: <code>GET /v1/extract/preview</code>. Full data: $0.01.</p>
    <div class="preview-cta">
      <form class="preview-form" id="preview-form">
        <div class="url-row">
          <input type="url" id="preview-url-input" name="url" inputmode="url" autocomplete="url"
            value="https://example.com/" placeholder="Paste any URL\u2026" required aria-label="URL to preview">
          <button class="btn" type="submit" id="preview-btn">Extract \u2197</button>
        </div>
        <p class="form-note">No sign-up needed. Results appear below instantly. <a href="/buy">Buy credits</a> for full API access \u2014 or copy the curl command and run it yourself.</p>
        <div class="quick-try">
          <span class="quick-try-label">Try:</span>
          <button type="button" class="quick-try-btn" data-url="https://example.com/">example.com</button>
          <button type="button" class="quick-try-btn" data-url="https://en.wikipedia.org/wiki/Web_scraping">Wikipedia</button>
          <button type="button" class="quick-try-btn" data-url="https://developer.mozilla.org/en-US/docs/Web/HTTP">MDN Docs</button>
          <button type="button" class="quick-try-btn" data-url="https://github.com/shoutsid-lab/webcap">GitHub repo</button>
          <button type="button" class="quick-try-btn" data-url="https://docs.python.org/3/">Python Docs</button>
        </div>
      </form>
      <div id="preview-results" class="preview-results" hidden></div>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       LIVE DEMO: See what a full extract looks like (no signup)
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="demo">
    <p class="eyebrow">Live demo</p>
    <h2>See what a full extract looks like</h2>
    <p class="hint">This is real output from the API \u2014 structured data from Hacker News, extracted in one call.</p>
    <div class="term" id="demo-term" aria-label="live demo of webcap extract output">
      <div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">webcap extract \u2014 Hacker News</span></div>
      <pre><code id="demo-code">Loading demo\u2026</code></pre>
    </div>
    <p style="text-align:center;margin-top:16px;font-size:14px;color:var(--muted)">One API call. All this data. <strong>$0.01 per batch.</strong> <a href="#preview">Try it yourself \u2193</a></p>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       FEATURES: What you get (benefit-led, not architecture-led)
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="features">
    <p class="eyebrow">What you get</p>
    <h2>Everything you need to capture the web</h2>
    <p class="hint">One API. Three capabilities. Pay only for what you use.</p>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">\u{1F4F7}</div>
        <h3>Capture</h3>
        <p>Screenshot any URL as PNG, JPEG, or PDF. Includes OG metadata for free.</p>
        <span class="feature-price">${esc(capturePrice)}/URL</span>
      </div>
      <div class="feature-card featured">
        <div class="feature-icon">\u{1F4CA}</div>
        <h3>Extract</h3>
        <p>Structured JSON: title, headings, links, paragraphs, markdown. Batch up to 50 URLs.</p>
        <span class="feature-price">${esc(extractPrice)}/batch</span>
      </div>
      <div class="feature-card">
        <div class="feature-icon">\u{1F514}</div>
        <h3>Monitor</h3>
        <p>Scheduled re-captures with webhook alerts. Detect any change, get notified.</p>
        <span class="feature-price">from ${esc(captureTopUpPrice)}/50 runs</span>
      </div>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       HOW IT WORKS: 3 clear steps
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="how">
    <p class="eyebrow">How it works</p>
    <h2>3 steps. No sign-up.</h2>
    <ol class="steps">
      <li><b>Call the API.</b>
        <p>POST <code>/v1/x402/capture</code> or <code>/v1/x402/extract</code>. The server answers with a payment challenge.</p></li>
      <li><b>Pay.</b>
        <p>Pay with <strong>crypto (x402 USDC)</strong>. No accounts, no API keys, no subscriptions. <a href="/buy">Buy credits</a> or pay per-call.</p></li>
      <li><b>Get your result.</b>
        <p>Instant response. Artifact served immediately. On-chain settlement for crypto payments.</p></li>
    </ol>
    <div class="term">${termBar('bash \u2014 quick start')}<pre><code><span class="c"># Free preview \u2014 no payment needed</span>
curl "${base}/v1/extract/preview?url=https://example.com/"

<span class="c"># Paid capture \u2014 returns 402, sign, retry</span>
curl -si -X POST "${base}/v1/x402/capture" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"url":"https://example.com/"}'</span>

<span class="c"># Paid extract \u2014 structured JSON from any URL</span>
curl -si -X POST "${base}/v1/x402/extract" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"urls":["https://example.com/"]}'</span></code></pre></div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       PRICING: Transparent, simple
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="pricing">
    <p class="eyebrow">Pricing</p>
    <h2>Pay per call. No accounts.</h2>
    <p class="hint">Flat per-call prices. Compute costs covered \u2014 you pay only
      for the capture, ${copy.settlement}. Pay with <strong>crypto (x402 USDC)</strong>. No minimums, no accounts. <a href="/buy">Buy credits</a>.</p>
    <div class="price-grid">
      <div class="price">
        <h3>Capture</h3>
        <div class="amount">${esc(capturePrice)} <small>/ URL</small></div>
        <p>PNG, JPEG or PDF screenshot. OG metadata is free: <code>GET /v1/og</code>.</p>
        <span class="tag">POST /v1/x402/capture</span>
      </div>
      <div class="price featured">
        <span class="flag">Most popular</span>
        <h3>Extract</h3>
        <div class="amount">${esc(extractPrice)} <small>/ URL batch</small></div>
        <p>Title, headings, links, markdown. Batch up to 50 URLs per payment.</p>
        <span class="tag">POST /v1/x402/extract</span>
      </div>
      <div class="price">
        <h3>Video</h3>
        <div class="amount">${esc(videoPrice)} <small>/ URL</small></div>
        <p>Full-page scroll capture as MP4. For demos and archiving.</p>
        <span class="tag">POST /v1/x402/video</span>
      </div>
      <div class="price">
        <h3>Analyze</h3>
        <div class="amount">${esc(analyzePrice)} <small>/ URL</small></div>
        <p>AI classification, accessibility audit, entity extraction.</p>
        <span class="tag">POST /v1/x402/analyze</span>
      </div>
    </div>
    <p class="hint" style="margin-top:var(--s5)">Also: <code>POST /v1/x402/audit</code> \u2014 SEO + link health for ${esc(auditPrice)}/URL. Full spec: <code><a href="/openapi.json">GET /openapi.json</a></code></p>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       CTA BANNER: Final conversion push
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="cta">
    <div class="cta-banner">
      <div class="cta-content">
        <h2>Start capturing the web today</h2>
        <p>No accounts. No API keys. Pay per-call with crypto.</p>
      </div>
      <div class="cta-actions">
        <a class="btn" href="#preview">Try it free \u2193</a>
        <a class="btn ghost" href="/buy">Buy credits \u2192</a>
      </div>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       NEWSLETTER: Email capture — standalone, always visible
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="newsletter">
    <div class="waitlist-card">
      <div class="waitlist-content">
        <h3>Stay in the loop</h3>
        <p>Get notified about new features, API improvements, and launch discounts. No spam — just product updates.</p>
      </div>
      <div class="waitlist-form">
        <form id="waitlist-form" class="waitlist-row">
          <input type="email" id="waitlist-email" placeholder="you@example.com" required aria-label="Email address">
          <button class="btn" type="submit" id="waitlist-btn">Subscribe</button>
        </form>
        <p class="waitlist-note" id="waitlist-note"></p>
      </div>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       MONITORING: Change detection with webhooks
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="monitoring">
    <p class="eyebrow">Monitoring</p>
    <h2>Change detection with webhook alerts</h2>
    <p class="hint">Point webcap at a URL on a schedule. Every run is compared against the previous one. A webhook fires when something changes. Runs are pre-paid in ${WATCH_TOPUP_RUNS}-run packs.</p>
    <div class="price-grid">
      <div class="price">
        <h3>Capture watch</h3>
        <div class="amount">${esc(captureTopUpPrice)} <small>/ ${WATCH_TOPUP_RUNS} runs</small></div>
        <p>${WATCH_TOPUP_RUNS} scheduled re-captures. Artifact bytes fingerprinted with sha256.</p>
        <span class="tag">${WATCH_TOPUP_RUNS} \u00D7 ${esc(capturePrice)} \u2014 POST /v1/x402/watches/topup</span>
      </div>
      <div class="price">
        <h3>Extract watch</h3>
        <div class="amount">${esc(extractTopUpPrice)} <small>/ ${WATCH_TOPUP_RUNS} runs</small></div>
        <p>${WATCH_TOPUP_RUNS} scheduled re-extractions. Field-level diff on change.</p>
        <span class="tag">${WATCH_TOPUP_RUNS} \u00D7 ${esc(extractPrice)} \u2014 POST /v1/x402/watches/topup</span>
      </div>
      <div class="price">
        <h3>Change alerts</h3>
        <div class="amount">$0 <small>/ with any watch</small></div>
        <p>Webhook fires POST with diff details when a change is detected.</p>
        <span class="tag">your https endpoint</span>
      </div>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       TRUST: Independent verification badges
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="trust">
    <p class="eyebrow">Trust</p>
    <p class="hint">Independently observed trust (third-party index, live-probed):</p>
    <div class="trust-strip">
      <a href="https://5.75.142.199.sslip.io/x402/trust/46929" target="_blank" rel="noopener"><img src="https://5.75.142.199.sslip.io/badge/x402/46929.svg" alt="x402 trust badge: capture route" loading="lazy"></a>
      <a href="https://5.75.142.199.sslip.io/x402/trust/46928" target="_blank" rel="noopener"><img src="https://5.75.142.199.sslip.io/badge/x402/46928.svg" alt="x402 trust badge: extract route" loading="lazy"></a>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       RESOURCES: Compact links
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="resources">
    <div class="link-strip">
      <a href="${bazaarCatalogUrl}" target="_blank" rel="noopener">CDP Bazaar listing <span class="arr">\u2197</span></a>
      <a href="/buy">Buy credits <span class="arr">\u2192</span></a>
      <a href="/openapi.json">/openapi.json <span class="arr">\u2192</span></a>
      <a href="/quickstart">quickstart guide <span class="arr">\u2192</span></a>
      <a href="/og-debugger">OG debugger <span class="arr">\u2192</span></a>
      <a href="/compare">vs alternatives <span class="arr">\u2192</span></a>
    </div>
  </section>
</main>
${footer(bazaarCatalogUrl)}

<script>
(function(){
  var base='${base}';
  var stripeConfigured=${stripeConfigured};
  /* --- social proof --- */
  fetch('/v1/status').then(function(r){return r.json();}).then(function(s){
    var el=document.getElementById('social-proof');
    var txt=document.getElementById('proof-text');
    var cap=document.getElementById('proof-captures');
    var ext=document.getElementById('proof-extracts');
    if(!el||!txt)return;
    var captures=0,extracts=0;
    if(s.endpoints&&s.endpoints.topHits){
      s.endpoints.topHits.forEach(function(e){
        if(e.endpoint&&e.endpoint.indexOf('/capture')!==-1)captures+=e.hits;
        if(e.endpoint&&e.endpoint.indexOf('/extract')!==-1)extracts+=e.hits;
      });
    }
    if(cap&&captures>0)cap.textContent=captures.toLocaleString();
    if(ext&&extracts>0)ext.textContent=extracts.toLocaleString();
    var parts=[];
    if(captures>0)parts.push(captures.toLocaleString()+' captures');
    if(extracts>0)parts.push(extracts.toLocaleString()+' extracts');
    if(parts.length===0)parts.push('API ready');
    parts.push('No API keys');
    parts.push('No accounts');
    txt.textContent=parts.join(' \u00B7 ');
    el.querySelector('.proof-icon').textContent='\u2713';
  }).catch(function(){});

  /* --- preview form --- */
  var form=document.getElementById('preview-form');
  if(!form)return;
  function doPreviewFetch(url,attempt){
    attempt=attempt||1;
    var ac;if(typeof AbortController!=='undefined'){ac=new AbortController();setTimeout(function(){ac.abort();},35000);}
    return fetch('/v1/extract/preview?url='+encodeURIComponent(url),ac?{signal:ac.signal}:undefined)
      .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();});
  }
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
    function onSuccess(d){
      var p=d.preview||{};
      var h='';
      var hCount=(p.headings||[]).length;
      var lCount=(p.links||[]).length;
      var wCount=p.wordCount||0;
      var curlCmd='curl -X POST "'+base+'/v1/x402/extract" -H "content-type: application/json" -d \'{"urls":["'+url+'"]}\'';
      /* --- header --- */
      h+='<div class="pr-header"><span class="pr-url">'+esc(p.title||url)+'</span>';
      if(d.truncated)h+='<span class="pr-badge">preview</span>';
      h+='</div>';
      if(p.description)h+='<p class="pr-desc">'+esc(p.description)+'</p>';
      /* --- UPGRADE CTA FIRST: high-visibility position before data --- */
      h+='<div class="pr-upgrade pr-upgrade-top">';
      h+='<div class="pr-upgrade-body">';
      h+='<div class="pr-upgrade-title"><span class="pr-upgrade-icon">\u{1F513}</span> Unlock full data \u2014 $0.01</div>';
      h+='<p style="margin:6px 0 10px;font-size:13px;color:var(--muted)">Get ALL '+hCount+' headings, ALL '+lCount+' links, full markdown, paragraphs, images, and AI classification. <strong>Batch up to 50 URLs per payment.</strong></p>';
      h+='</div>';
      h+='<div class="pr-upgrade-actions">';
      if(stripeConfigured){
        h+='<a href="'+esc(base)+'/buy" class="pr-upgrade-btn pr-pay-now" style="display:inline-block;text-decoration:none;font-weight:700;background:var(--accent);color:var(--accent-ink);border:none;cursor:pointer;text-align:center">\u{1F4B3} Buy credits with card \u2192</a>';
      } else {
        h+='<div class="pr-upgrade-email" style="margin-bottom:8px">';
        h+='<form class="pr-upgrade-email-form" style="display:flex;gap:0;border-radius:var(--r-m);overflow:hidden;border:1px solid var(--accent)">';
        h+='<input type="email" placeholder="you@email.com" required aria-label="Email for purchase" style="flex:1;padding:10px 14px;border:none;font-size:14px;font-family:var(--mono);background:var(--bg);color:var(--text);min-width:0">';
        h+='<button type="submit" class="pr-upgrade-email-btn" style="padding:10px 18px;font-size:14px;font-weight:700;background:var(--accent);color:var(--accent-ink);border:none;cursor:pointer;font-family:var(--mono);white-space:nowrap">Get $0.01 credits \u2192</button>';
        h+='</form>';
        h+='<p style="margin:6px 0 0;font-size:11px;color:var(--faint)">We\u2019ll email you a payment link within 24h. No account needed.</p>';
        h+='</div>';
      }
      h+='<button class="pr-upgrade-btn pr-copy-main" data-curl="'+esc(curlCmd)+'" title="Copy curl command to clipboard">\u{1F4CB} Or pay with crypto (curl)</button>';
      h+='</div>';
      h+='<div class="pr-copy-toast" id="copy-toast" hidden>\u2713 Copied! Paste in your terminal and run.</div>';
      h+='<div class="pr-pay-instructions" id="pr-pay-instructions" hidden>';
      h+='<div style="padding:16px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-m);margin-top:12px">';
      h+='<p style="font-weight:700;margin:0 0 12px;font-size:14px">\u2705 Command copied! Here\u2019s what to do:</p>';
      h+='<div style="display:flex;gap:12px;margin-bottom:12px">';
      h+='<div style="flex:1;padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-s)">';
      h+='<p style="font-weight:700;margin:0 0 4px;font-size:13px;color:var(--accent)">Step 1: Paste in terminal</p>';
      h+='<p style="margin:0;font-size:12px;color:var(--muted)">The curl command is on your clipboard. Paste and run it.</p>';
      h+='</div>';
      h+='<div style="flex:1;padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-s)">';
      h+='<p style="font-weight:700;margin:0 0 4px;font-size:13px;color:var(--accent)">Step 2: Sign the payment</p>';
      h+='<p style="margin:0;font-size:12px;color:var(--muted)">Server returns payment instructions. Sign once with your wallet.</p>';
      h+='</div>';
      h+='</div>';
      h+='<div style="position:relative"><pre style="background:var(--bg);padding:12px 16px;border-radius:var(--r-s);font-size:12px;overflow-x:auto;margin:0;border:1px solid var(--line)"><code>'+esc(curlCmd)+'</code></pre>';
      h+='<button class="pr-copy-btn" style="position:absolute;top:8px;right:8px;padding:4px 10px;font-size:11px" data-curl="'+esc(curlCmd)+'">Copy</button></div>';
      h+='</div></div>';
      /* --- USER-SPECIFIC COMPARISON: show what they're missing --- */
      h+='<div class="pr-auto-demo" id="pr-auto-demo" style="padding:16px 18px;background:rgba(37,99,235,.04);border:1px solid rgba(37,99,235,.15);border-radius:var(--r-m)">';
      h+='<span class="pr-label" style="color:var(--accent);font-weight:700">\u{1F4CA} What you got vs what you\\'re missing</span>';
      h+='<table style="width:100%;border-collapse:collapse;margin-top:10px;font-family:var(--mono);font-size:12px">';
      h+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--faint);font-size:11px"></td><td style="padding:5px 10px;color:var(--faint);text-align:center;font-size:11px">Preview (free)</td><td style="padding:5px 10px;color:var(--accent);text-align:center;font-weight:700;font-size:11px">Full extract ($0.01)</td></tr>';
      h+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Title</td><td style="padding:5px 10px;text-align:center">\u2713 '+esc((p.title||'').slice(0,30))+'</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713 '+esc((p.title||'').slice(0,30))+'</td></tr>';
      h+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Headings</td><td style="padding:5px 10px;text-align:center">'+hCount+' shown</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">all of them</td></tr>';
      h+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Links</td><td style="padding:5px 10px;text-align:center">'+lCount+' shown</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">all of them</td></tr>';
      h+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Word count</td><td style="padding:5px 10px;text-align:center">'+wCount+'</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">full count</td></tr>';
      h+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Full markdown</td><td style="padding:5px 10px;text-align:center">\u2717 truncated</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713 complete</td></tr>';
      h+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Paragraphs</td><td style="padding:5px 10px;text-align:center">\u2717</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713 all</td></tr>';
      h+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Images</td><td style="padding:5px 10px;text-align:center">\u2717</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713 all</td></tr>';
      h+='<tr><td style="padding:5px 0;color:var(--muted)">AI classification</td><td style="padding:5px 10px;text-align:center">\u2717</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713 type + confidence</td></tr>';
      h+='</table>';
      h+='<p style="margin-top:10px;font-size:12px;color:var(--muted)">\u{1F4A1} One $0.01 payment gets you EVERYTHING: all headings, all links, full markdown, paragraphs, images, and AI classification. <strong>One payment covers up to 50 URLs.</strong></p>';
      h+='</div>';
      /* --- preview data BELOW the CTA: users can see what they got --- */
      if(p.headings&&p.headings.length){
        h+='<div class="pr-section"><span class="pr-label">Headings ('+hCount+(d.truncated?' preview \u2014 more in full extract':'')+') '+'</span><ul>';
        p.headings.slice(0,8).forEach(function(heading){h+='<li><span class="pr-h'+heading.level+'">H'+heading.level+'</span> '+esc(heading.text)+'</li>';});
        h+='</ul></div>';
      }
      if(p.links&&p.links.length){
        h+='<div class="pr-section"><span class="pr-label">Links ('+p.links.length+(d.truncated?' shown':'')+')</span>';
        h+='<div class="pr-links">';
        p.links.slice(0,6).forEach(function(link){h+='<a href="'+esc(link.href)+'" target="_blank" rel="noopener">'+esc(link.text||link.href)+'</a>';});
        if(p.links.length>6)h+='<span class="pr-more">+'+(p.links.length-6)+' more</span>';
        h+='</div></div>';
      }
      if(p.wordCount)h+='<div class="pr-section"><span class="pr-label">Words</span> '+p.wordCount+(d.truncated?' (truncated)':'')+'</div>';
      /* --- secondary actions at bottom --- */
      h+='<div class="pr-bottom-actions">';
      h+='<a href="'+esc(base)+'/quickstart" class="pr-upgrade-link" data-track="quickstart_click">Quick start guide \u2197</a>';
      h+='</div>';
      h+='<div class="pr-email-capture">';
      h+='<p>Not ready to pay? Get product updates:</p>';
      h+='<form class="email-form" id="email-capture-form">';
      h+='<input type="email" placeholder="you@example.com" required aria-label="Email for updates">';
      h+='<button type="submit" class="btn-sm">Subscribe</button>';
      h+='</form>';
      h+='<p class="email-note">No spam. Unsubscribe anytime.</p>';
      h+='</div>';
      h+='<div class="pr-try-another"><button class="btn-sm pr-try-btn" data-url="https://en.wikipedia.org/wiki/Web_scraping">Wikipedia</button> <button class="btn-sm pr-try-btn" data-url="https://developer.mozilla.org/en-US/docs/Web/HTTP">MDN Docs</button> <button class="btn-sm pr-try-btn" data-url="https://github.com/shoutsid-lab/webcap">GitHub repo</button> <button class="btn-sm pr-try-btn" data-url="https://docs.python.org/3/">Python Docs</button></div>';
      if(results){results.innerHTML=h;results.scrollIntoView({behavior:'smooth',block:'start'});}
      /* --- inline email purchase form (when Stripe not configured) --- */
      var emailForms=results?results.querySelectorAll('.pr-upgrade-email-form'):null;
      if(emailForms){emailForms.forEach(function(ef){
        ef.addEventListener('submit',function(e){
          e.preventDefault();
          var emailInput=ef.querySelector('input[type="email"]');
          var email=emailInput?emailInput.value.trim():'';
          if(!email)return;
          try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_email_purchase',email:email}})],{type:'application/json'}));}catch(ex){}
          fetch('/v1/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'purchase_request',meta:{email:email,url:url,source:'preview_inline'}})}).catch(function(){});
          fetch('/v1/waitlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email})}).catch(function(){});
          var btn=ef.querySelector('button[type="submit"]');
          if(btn){btn.textContent='\u2713 Sent!';btn.style.background='var(--ok)';btn.disabled=true;}
          emailInput.disabled=true;emailInput.style.opacity='0.6';
          var note=ef.parentNode?ef.parentNode.querySelector('p'):null;
          if(note){note.innerHTML='<span style="color:var(--ok)">Check your inbox for a payment link.</span>';}
          showToast('Request sent! Check your email.',4000);
        });
      });}
      /* --- primary copy button (big) --- */
      var mainCopyBtn=results?results.querySelector('.pr-copy-main'):null;
      if(mainCopyBtn){mainCopyBtn.addEventListener('click',function(){
        var curl=mainCopyBtn.getAttribute('data-curl')||'';
        if(navigator.clipboard){navigator.clipboard.writeText(curl).then(function(){
          mainCopyBtn.textContent='\u2713 Copied!';setTimeout(function(){mainCopyBtn.textContent='\u{1F4CB} Copy command';},3000);
          var toast=results?results.querySelector('#copy-toast'):null;
          if(toast){toast.hidden=false;setTimeout(function(){toast.hidden=true;},5000);}
        });}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'curl_copy',meta:{url:url,source:'preview_success'}})],{type:'application/json'}));}catch(ex){}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_results_copy'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- secondary copy button (small) --- */
      var copyBtn=results?results.querySelector('.pr-copy-btn'):null;
      if(copyBtn){copyBtn.addEventListener('click',function(){
        var curl=copyBtn.getAttribute('data-curl')||'';
        if(navigator.clipboard){navigator.clipboard.writeText(curl).then(function(){
          copyBtn.textContent='Copied!';setTimeout(function(){copyBtn.textContent='Copy';},2000);
          var toast=results?results.querySelector('#copy-toast'):null;
          if(toast){toast.hidden=false;setTimeout(function(){toast.hidden=true;},5000);}
        });}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'curl_copy',meta:{url:url,source:'preview_success'}})],{type:'application/json'}));}catch(ex){}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_results_copy'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- api docs link tracking --- */
      var docsLink=results?results.querySelector('.pr-upgrade-link'):null;
      if(docsLink){docsLink.addEventListener('click',function(){
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_results'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- pay now button: copy command + show step-by-step guide --- */
      var payNowBtn=results?results.querySelector('#pr-pay-now'):null;
      if(payNowBtn){payNowBtn.addEventListener('click',function(){
        var curl=payNowBtn.getAttribute('data-curl')||'';
        /* Copy command to clipboard */
        if(navigator.clipboard&&curl){navigator.clipboard.writeText(curl).then(function(){
          var toast=results?results.querySelector('#copy-toast'):null;
          if(toast){toast.hidden=false;setTimeout(function(){toast.hidden=true;},3000);}
        });}
        /* Show step-by-step instructions */
        var instr=results?results.querySelector('#pr-pay-instructions'):null;
        if(instr){instr.hidden=false;instr.scrollIntoView({behavior:'smooth',block:'nearest'});}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_pay_now'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- buy credits link tracking --- */
      var buyLink=results?results.querySelector('.pr-buy-link'):null;
      if(buyLink){buyLink.addEventListener('click',function(){
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_results'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- comparison table is now inline (built above) --- */
      try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'demo_view',meta:{url:url,source:'preview_inline',headings:hCount,links:lCount,words:wCount}})],{type:'application/json'}));}catch(ex){}
      /* email capture */
      var emailForm=results?results.querySelector('#email-capture-form'):null;
      if(emailForm){emailForm.addEventListener('submit',function(e){
        e.preventDefault();
        var emailInput=emailForm.querySelector('input[type="email"]');
        var email=emailInput?emailInput.value.trim():'';
        if(!email)return;
        fetch('/v1/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'email_subscribe',meta:{email:email,url:url}})}).catch(function(){});
        emailForm.innerHTML='<p style="color:var(--ok);font-weight:600">\u2713 Subscribed! Check your inbox.</p>';
      });}
      /* --- try another URL buttons --- */
      var tryBtns=results?results.querySelectorAll('.pr-try-btn'):null;
      if(tryBtns){tryBtns.forEach(function(btn){btn.addEventListener('click',function(){
        var tryUrl=btn.getAttribute('data-url')||'';
        var input2=document.getElementById('preview-url-input');
        if(input2&&tryUrl)input2.value=tryUrl;
        form.dispatchEvent(new Event('submit'));
      });});}
      try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'preview_result_success',meta:{url:url,wordCount:p.wordCount||0,headingCount:(p.headings||[]).length,linkCount:(p.links||[]).length}})],{type:'application/json'}));}catch(ex){}
    }
    function onFail(err){
      var errMsg=String(err);
      var hint='';
      var friendlyMsg='Preview failed';
      if(errMsg.indexOf('Failed to fetch')!==-1||errMsg.indexOf('AbortError')!==-1){
        friendlyMsg='Request timed out';
        hint='<p class="pr-hint">The site took too long to respond. This can happen with heavy pages or sites that block automated requests. Try a simpler URL, or use the paid API for reliable capture.</p>';
      }else if(errMsg.indexOf('429')!==-1||errMsg.indexOf('rate')!==-1){
        friendlyMsg='Rate limited';
        hint='<p class="pr-hint">Too many requests. Wait a minute and try again, or use the paid API for unlimited access.</p>';
      }else if(errMsg.indexOf('404')!==-1||errMsg.indexOf('not found')!==-1){
        friendlyMsg='URL not found';
        hint='<p class="pr-hint">The page doesn\'t exist. Check the URL and try again. Make sure it starts with <code>https://</code>.</p>';
      }else if(errMsg.indexOf('502')!==-1){
        friendlyMsg='Site blocked capture';
        hint='<p class="pr-hint">This site blocks automated requests. The paid API uses advanced browser-level capture that handles most blocking. Try it with the full extract.</p>';
      }else if(errMsg.indexOf('network')!==-1||errMsg.indexOf('ENOTFOUND')!==-1){
        friendlyMsg='DNS resolution failed';
        hint='<p class="pr-hint">The domain couldn\'t be resolved. Check for typos in the URL.</p>';
      }
      var retryBtn='<button class="btn-sm pr-retry-btn" data-url="https://example.com/">Try example.com</button> <button class="btn-sm pr-retry-btn" data-url="https://en.wikipedia.org/wiki/Web_scraping">Try Wikipedia</button> <button class="btn-sm pr-retry-btn" data-url="https://developer.mozilla.org/en-US/docs/Web/HTTP">Try MDN</button> <button class="btn-sm pr-retry-btn" data-url="'+url+'">Retry this URL</button>';
      /* --- upgrade CTA on error: card-first + crypto fallback --- */
      var errCta='';
      var errCurlCmd='curl -X POST "'+base+'/v1/x402/extract" -H "content-type: application/json" -d \'{"urls":["'+url+'"]}\'';
      errCta+='<div class="pr-upgrade">';
      errCta+='<div class="pr-upgrade-body">';
      errCta+='<div class="pr-upgrade-title"><span class="pr-upgrade-icon">\u{1F513}</span> Unlock full data \u2014 $0.01</div>';
      errCta+='<p style="margin:4px 0 8px;font-size:12px;color:var(--muted)">Full markdown, all headings & links, images, paragraphs, and AI classification. <strong>Batch up to 50 URLs per payment.</strong> No accounts needed.</p>';
      errCta+='</div>';
      errCta+='<div class="pr-upgrade-actions">';
      if(stripeConfigured){
        errCta+='<a href="'+esc(base)+'/buy" class="pr-upgrade-btn pr-pay-now" style="display:inline-block;text-decoration:none;font-weight:700;background:var(--accent);color:var(--accent-ink);border:none;cursor:pointer;text-align:center">\u{1F4B3} Buy credits with card \u2192</a>';
      } else {
        errCta+='<div class="pr-upgrade-email" style="margin-bottom:8px">';
        errCta+='<form class="pr-upgrade-email-form" style="display:flex;gap:0;border-radius:var(--r-m);overflow:hidden;border:1px solid var(--accent)">';
        errCta+='<input type="email" placeholder="you@email.com" required aria-label="Email for purchase" style="flex:1;padding:10px 14px;border:none;font-size:14px;font-family:var(--mono);background:var(--bg);color:var(--text);min-width:0">';
        errCta+='<button type="submit" class="pr-upgrade-email-btn" style="padding:10px 18px;font-size:14px;font-weight:700;background:var(--accent);color:var(--accent-ink);border:none;cursor:pointer;font-family:var(--mono);white-space:nowrap">Get $0.01 credits \u2192</button>';
        errCta+='</form>';
        errCta+='<p style="margin:6px 0 0;font-size:11px;color:var(--faint)">We\u2019ll email you a payment link within 24h. No account needed.</p>';
        errCta+='</div>';
      }
      errCta+='<button class="pr-upgrade-btn pr-copy-main" data-curl="'+esc(errCurlCmd)+'" title="Copy curl command to clipboard">\u{1F4CB} Or pay with crypto (curl)</button>';
      errCta+='</div>';
      errCta+='<div class="pr-copy-toast" id="copy-toast" hidden>\u2713 Copied! Paste in your terminal and run.</div>';
      errCta+='<div class="pr-pay-instructions" id="pr-pay-instructions" hidden>';
      errCta+='<div style="padding:16px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-m);margin-top:12px">';
      errCta+='<p style="font-weight:700;margin:0 0 12px;font-size:14px">\u2705 Command copied! Here\u2019s what to do:</p>';
      errCta+='<div style="display:flex;gap:12px;margin-bottom:12px">';
      errCta+='<div style="flex:1;padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-s)">';
      errCta+='<p style="font-weight:700;margin:0 0 4px;font-size:13px;color:var(--accent)">Step 1: Paste in terminal</p>';
      errCta+='<p style="margin:0;font-size:12px;color:var(--muted)">The curl command is on your clipboard. Paste and run it.</p>';
      errCta+='</div>';
      errCta+='<div style="flex:1;padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:var(--r-s)">';
      errCta+='<p style="font-weight:700;margin:0 0 4px;font-size:13px;color:var(--accent)">Step 2: Sign the payment</p>';
      errCta+='<p style="margin:0;font-size:12px;color:var(--muted)">Server returns payment instructions. Sign once with your wallet.</p>';
      errCta+='</div>';
      errCta+='</div>';
      errCta+='<div style="position:relative"><pre style="background:var(--bg);padding:12px 16px;border-radius:var(--r-s);font-size:12px;overflow-x:auto;margin:0;border:1px solid var(--line)"><code>'+esc(errCurlCmd)+'</code></pre>';
      errCta+='<button class="pr-copy-btn" style="position:absolute;top:8px;right:8px;padding:4px 10px;font-size:11px" data-curl="'+esc(errCurlCmd)+'">Copy</button></div>';
      errCta+='</div></div>';
      /* --- STATIC COMPARISON on error: show what full extract offers --- */
      errCta+='<div class="pr-auto-demo" id="pr-auto-demo" style="margin-top:16px;padding:16px 18px;background:rgba(37,99,235,.04);border:1px solid rgba(37,99,235,.15);border-radius:var(--r-m)">';
      errCta+='<span class="pr-label" style="color:var(--accent);font-weight:700">\u{1F4CA} What the full extract gives you</span>';
      errCta+='<table style="width:100%;border-collapse:collapse;margin-top:10px;font-family:var(--mono);font-size:12px">';
      errCta+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Feature</td><td style="padding:5px 10px;color:var(--accent);text-align:center;font-weight:700">$0.01 per batch</td></tr>';
      errCta+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Title + description</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713</td></tr>';
      errCta+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">All headings (H1-H6)</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713</td></tr>';
      errCta+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">All links with text</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713</td></tr>';
      errCta+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Full markdown</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713</td></tr>';
      errCta+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Paragraphs</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713</td></tr>';
      errCta+='<tr style="border-bottom:1px solid rgba(37,99,235,.1)"><td style="padding:5px 0;color:var(--muted)">Images</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713</td></tr>';
      errCta+='<tr><td style="padding:5px 0;color:var(--muted)">AI classification</td><td style="padding:5px 10px;text-align:center;color:var(--ok)">\u2713</td></tr>';
      errCta+='</table>';
      errCta+='<p style="margin-top:10px;font-size:12px;color:var(--muted)">\u{1F4A1} Browser-level capture handles blocking sites. <strong>Batch up to 50 URLs per payment.</strong></p>';
      errCta+='</div>';
      errCta+='<div class="pr-email-capture">';
      errCta+='<p>Not ready to pay? Get product updates:</p>';
      errCta+='<form class="email-form" id="email-capture-form">';
      errCta+='<input type="email" placeholder="you@example.com" required aria-label="Email for updates">';
      errCta+='<button type="submit" class="btn-sm">Subscribe</button>';
      errCta+='</form>';
      errCta+='<p class="email-note">No spam. Unsubscribe anytime.</p>';
      errCta+='</div>';
      errCta+='<div class="pr-try-another"><button class="btn-sm pr-try-btn" data-url="https://example.com/">Try example.com</button> <button class="btn-sm pr-try-btn" data-url="https://en.wikipedia.org/wiki/Web_scraping">Try Wikipedia</button> <button class="btn-sm pr-try-btn" data-url="https://developer.mozilla.org/en-US/docs/Web/HTTP">Try MDN</button> <button class="btn-sm pr-try-btn" data-url="https://docs.python.org/3/">Try Python Docs</button></div>';
      /* Put the error FIRST — users need to understand what went wrong before seeing solutions */
      var errHtml='<div class="pr-error"><span class="pr-error-icon">\u26A0\uFE0F</span> <strong>'+esc(friendlyMsg)+'</strong>: '+esc(errMsg)+' '+hint+'<div class="pr-error-actions">'+retryBtn+'<a href="/v1/extract/preview?url='+encodeURIComponent(url)+'" target="_blank" class="pr-error-link">View raw JSON \u2197</a></div></div>';
      if(results){results.innerHTML=errHtml+errCta;results.scrollIntoView({behavior:'smooth',block:'start'});}
      /* --- inline email purchase form on error (when Stripe not configured) --- */
      var errEmailForms=results?results.querySelectorAll('.pr-upgrade-email-form'):null;
      if(errEmailForms){errEmailForms.forEach(function(ef){
        ef.addEventListener('submit',function(e){
          e.preventDefault();
          var emailInput=ef.querySelector('input[type="email"]');
          var email=emailInput?emailInput.value.trim():'';
          if(!email)return;
          try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_error_email_purchase',email:email}})],{type:'application/json'}));}catch(ex){}
          fetch('/v1/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'purchase_request',meta:{email:email,url:url,source:'preview_error_inline'}})}).catch(function(){});
          fetch('/v1/waitlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email})}).catch(function(){});
          var btn=ef.querySelector('button[type="submit"]');
          if(btn){btn.textContent='\u2713 Sent!';btn.style.background='var(--ok)';btn.disabled=true;}
          emailInput.disabled=true;emailInput.style.opacity='0.6';
          var note=ef.parentNode?ef.parentNode.querySelector('p'):null;
          if(note){note.innerHTML='<span style="color:var(--ok)">Check your inbox for a payment link.</span>';}
          showToast('Request sent! Check your email.',4000);
        });
      });}
      var retryEls=results?results.querySelectorAll('.pr-retry-btn'):null;
      if(retryEls){retryEls.forEach(function(el){el.addEventListener('click',function(){
        var tryUrl=el.getAttribute('data-url')||'https://example.com/';
        var input2=document.getElementById('preview-url-input');
        if(input2)input2.value=tryUrl;
        form.dispatchEvent(new Event('submit'));
      });});}
      /* --- primary copy button (big) on error state --- */
      var errMainCopyBtn=results?results.querySelector('.pr-copy-main'):null;
      if(errMainCopyBtn){errMainCopyBtn.addEventListener('click',function(){
        var curl=errMainCopyBtn.getAttribute('data-curl')||'';
        if(navigator.clipboard){navigator.clipboard.writeText(curl).then(function(){
          errMainCopyBtn.textContent='\u2713 Copied!';setTimeout(function(){errMainCopyBtn.textContent='\u{1F4CB} Copy command';},3000);
          var toast=results?results.querySelector('#copy-toast'):null;
          if(toast){toast.hidden=false;setTimeout(function(){toast.hidden=true;},5000);}
        });}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'curl_copy',meta:{url:url,source:'preview_error'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- secondary copy button (small) on error state --- */
      var errCopyBtn=results?results.querySelector('.pr-copy-btn'):null;
      if(errCopyBtn){errCopyBtn.addEventListener('click',function(){
        var curl=errCopyBtn.getAttribute('data-curl')||'';
        if(navigator.clipboard){navigator.clipboard.writeText(curl).then(function(){
          errCopyBtn.textContent='Copied!';setTimeout(function(){errCopyBtn.textContent='Copy';},2000);
          var toast=results?results.querySelector('#copy-toast'):null;
          if(toast){toast.hidden=false;setTimeout(function(){toast.hidden=true;},5000);}
        });}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'curl_copy',meta:{url:url,source:'preview_error'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- api docs link tracking on error state --- */
      var errDocsLink=results?results.querySelector('.pr-upgrade-link'):null;
      if(errDocsLink){errDocsLink.addEventListener('click',function(){
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_error'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- buy credits link tracking on error state --- */
      var errBuyLink=results?results.querySelector('.pr-buy-link'):null;
      if(errBuyLink){errBuyLink.addEventListener('click',function(){
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_error'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- pay now button on error state: copy command + show guide --- */
      var errPayNowBtn=results?results.querySelector('#pr-pay-now'):null;
      if(errPayNowBtn){errPayNowBtn.addEventListener('click',function(){
        var curl=errPayNowBtn.getAttribute('data-curl')||'';
        /* Copy command to clipboard */
        if(navigator.clipboard&&curl){navigator.clipboard.writeText(curl).then(function(){
          var toast=results?results.querySelector('#copy-toast'):null;
          if(toast){toast.hidden=false;setTimeout(function(){toast.hidden=true;},3000);}
        });}
        /* Show step-by-step instructions */
        var instr=results?results.querySelector('#pr-pay-instructions'):null;
        if(instr){instr.hidden=false;instr.scrollIntoView({behavior:'smooth',block:'nearest'});}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_error_pay_now'}})],{type:'application/json'}));}catch(ex){}
      });}
      /* --- comparison table is now inline (built above) --- */
      /* email capture on error state */
      var errEmailForm=results?results.querySelector('#email-capture-form'):null;
      if(errEmailForm){errEmailForm.addEventListener('submit',function(e){
        e.preventDefault();
        var emailInput=errEmailForm.querySelector('input[type="email"]');
        var email=emailInput?emailInput.value.trim():'';
        if(!email)return;
        fetch('/v1/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'email_subscribe',meta:{email:email,url:url,source:'preview_error'}})}).catch(function(){});
        errEmailForm.innerHTML='<p style="color:var(--ok);font-weight:600">\u2713 Subscribed! Check your inbox.</p>';
      });}
      /* --- try another URL buttons on error state --- */
      var errTryBtns=results?results.querySelectorAll('.pr-try-btn'):null;
      if(errTryBtns){errTryBtns.forEach(function(btn){btn.addEventListener('click',function(){
        var tryUrl=btn.getAttribute('data-url')||'';
        var input2=document.getElementById('preview-url-input');
        if(input2&&tryUrl)input2.value=tryUrl;
        form.dispatchEvent(new Event('submit'));
      });});}
      /* classify error type for analytics */
      var errorType='other';
      if(errMsg.indexOf('502')!==-1)errorType='capture_failed';
      else if(errMsg.indexOf('429')!==-1||errMsg.indexOf('rate')!==-1)errorType='rate_limited';
      else if(errMsg.indexOf('Failed to fetch')!==-1||errMsg.indexOf('AbortError')!==-1)errorType='network_timeout';
      else if(errMsg.indexOf('404')!==-1||errMsg.indexOf('not found')!==-1)errorType='not_found';
      else if(errMsg.indexOf('422')!==-1)errorType='invalid_url';
      else if(errMsg.indexOf('403')!==-1)errorType='blocked';
      else if(errMsg.indexOf('ENOTFOUND')!==-1||err.name==='TypeError')errorType='dns_error';
      try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'preview_result_error',meta:{url:url,error:errMsg,errorType:errorType}})],{type:'application/json'}));}catch(ex){}
    }
    doPreviewFetch(url,1)
      .then(function(d){onSuccess(d);})
      .catch(function(err){
        /* Retry twice on transient errors: network hiccups, 502 (server may fallback on retry) */
        var e=String(err);
        if(e.indexOf('Failed to fetch')!==-1||e.indexOf('AbortError')!==-1||e.indexOf('502')!==-1){
          return new Promise(function(resolve){setTimeout(resolve,1000);}).then(function(){
            return doPreviewFetch(url,2);
          }).then(function(d){onSuccess(d);}).catch(function(err2){
            var e2=String(err2);
            if(e2.indexOf('Failed to fetch')!==-1||e2.indexOf('AbortError')!==-1||e2.indexOf('502')!==-1){
              return new Promise(function(resolve){setTimeout(resolve,2000);}).then(function(){
                return doPreviewFetch(url,3);
              }).then(function(d){onSuccess(d);}).catch(function(err3){onFail(err3);});
            }
            onFail(err2);
          });
        }
        onFail(err);
      })
      .finally(function(){
        if(btn){btn.disabled=false;btn.textContent='Extract \u2197';}
      });
  });
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  /* --- waitlist form --- */
  var wlForm=document.getElementById('waitlist-form');
  var wlNote=document.getElementById('waitlist-note');
  if(wlForm){wlForm.addEventListener('submit',function(e){
    e.preventDefault();
    var emailInput=document.getElementById('waitlist-email');
    var btn=document.getElementById('waitlist-btn');
    var email=emailInput?emailInput.value.trim():'';
    if(!email)return;
    if(btn){btn.disabled=true;btn.textContent='Joining\u2026';}
    fetch('/v1/waitlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email})})
      .then(function(r){return r.json();})
      .then(function(d){
        if(wlNote){wlNote.className='waitlist-note success';wlNote.textContent='\u2713 You\'re on the list! Check your inbox for a welcome email.';}
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'email_subscribe',meta:{email:email,source:'landing_newsletter'}})],{type:'application/json'}));}catch(ex){}
      })
      .catch(function(){
        if(wlNote){wlNote.className='waitlist-note error';wlNote.textContent='Something went wrong. Please try again.';}
      })
      .finally(function(){
        if(btn){btn.disabled=false;btn.textContent='Subscribe';}
      });
  });}

  /* --- Live demo: fetch /v1/demo and display structured output --- */
  var demoCode=document.getElementById('demo-code');
  if(demoCode){
    fetch('/v1/demo').then(function(r){return r.json();}).then(function(d){
      var results=d.results||[];
      if(!results.length){demoCode.textContent='No demo available';return;}
      var r=results[0];
      var out='';
      out+='URL: '+(r.url||'')+'\n';
      out+='Title: '+(r.title||'')+'\n';
      out+='Description: '+(r.description||'').slice(0,120)+'...\n\n';
      out+='Headings ('+((r.headings||[]).length)+'):\n';
      (r.headings||[]).slice(0,6).forEach(function(h){out+='  H'+h.level+': '+h.text+'\n';});
      out+='\nLinks ('+((r.links||[]).length)+'):\n';
      (r.links||[]).slice(0,5).forEach(function(l){out+='  '+(l.text||l.href).slice(0,50)+'\n';});
      out+='\nWord count: '+(r.wordCount||0)+'\n';
      out+='Paragraphs: '+((r.paragraphs||[]).length)+'\n';
      out+='Images: '+((r.images||[]).length)+'\n';
      out+='\n--- Full markdown (first 500 chars) ---\n';
      out+=(r.markdown||'').slice(0,500)+'...\n';
      demoCode.textContent=out;
      try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'demo_view',meta:{source:'landing_demo_section'}})],{type:'application/json'}));}catch(ex){}
    }).catch(function(){demoCode.textContent='Demo unavailable. Try the live preview above.';});
  }

  /* --- Quick-try buttons --- */
  var quickBtns=document.querySelectorAll('.quick-try-btn');
  if(quickBtns){quickBtns.forEach(function(btn){btn.addEventListener('click',function(){
    var tryUrl=btn.getAttribute('data-url')||'';
    var input2=document.getElementById('preview-url-input');
    if(input2&&tryUrl)input2.value=tryUrl;
    form.dispatchEvent(new Event('submit'));
  });});}

  /* --- CTA click tracking --- */
  document.querySelectorAll('.btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'cta_click',meta:{text:btn.textContent||'',href:btn.getAttribute('href')||''}})],{type:'application/json'}));}catch(ex){}
      /* Also fire upgrade_click for Buy credits buttons */
      if(btn.getAttribute('data-upgrade')){
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{source:'hero_cta',text:btn.textContent||'',href:btn.getAttribute('href')||''}})],{type:'application/json'}));}catch(ex){}
      }
    });
  });
})();
</script>
</body>
</html>`;
}
