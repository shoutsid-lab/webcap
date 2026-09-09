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
        <span class="trust-label">x402 / Stripe</span>
      </div>
    </div>
  </section>

  <!-- ═══════════════════════════════════════════════════════════════
       INTERACTIVE PREVIEW: Try before you buy
       ═══════════════════════════════════════════════════════════════ -->
  <section class="section wrap" id="preview">
    <p class="eyebrow">Try it free</p>
    <h2>Extract any URL instantly</h2>
    <p class="hint">Paste a URL and see what webcap extracts. Free endpoint: <code>GET /v1/extract/preview</code>. Full API: $0.01 via x402.</p>
    <div class="preview-cta">
      <form class="preview-form" id="preview-form">
        <div class="url-row">
          <input type="url" id="preview-url-input" name="url" inputmode="url" autocomplete="url"
            value="https://news.ycombinator.com/" placeholder="https://example.com/" required aria-label="URL to preview">
          <button class="btn" type="submit" id="preview-btn">Extract \u2197</button>
        </div>
        <p class="form-note">Results appear below. Full data via x402. <a href="/og-debugger">OG debugger</a> for meta tags.</p>
      </form>
      <div id="preview-results" class="preview-results" hidden></div>
    </div>
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
      <li><b>Sign the payment.</b>
        <p>Sign a gasless EIP-3009 transfer with your wallet. No ETH needed for gas.</p></li>
      <li><b>Get your result.</b>
        <p>Retry with the payment header. Settled on-chain. Artifact served immediately.</p></li>
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
      for the capture, ${copy.settlement}. Pay with card (Stripe) or crypto (x402 USDC). No minimums, no accounts.</p>
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
        <p>No accounts. No API keys. Just HTTP calls.</p>
      </div>
      <div class="cta-actions">
        <a class="btn" href="#preview">Try it free \u2193</a>
        <a class="btn ghost" href="https://github.com/shoutsid-lab/webcap" target="_blank" rel="noopener">\u{1F4BB} View source</a>
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
      <a href="/openapi.json">/openapi.json <span class="arr">\u2192</span></a>
      <a href="/og-debugger">OG debugger <span class="arr">\u2192</span></a>
      <a href="/compare">vs alternatives <span class="arr">\u2192</span></a>
    </div>
  </section>
</main>
${footer(bazaarCatalogUrl)}

<script>
(function(){
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
    var ac;if(typeof AbortController!=='undefined'){ac=new AbortController();setTimeout(function(){ac.abort();},30000);}
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
      h+='<div class="pr-upgrade">';
      h+='<div><span class="pr-upgrade-icon">\u2191</span> Free preview is truncated. Full extract: $0.01/batch via x402 USDC.</div>';
      h+='<a href="#pricing" class="pr-upgrade-btn" data-track="upgrade_click">Get full extract \u2192</a>';
      h+='</div>';
      if(results)results.innerHTML=h;
      /* attach click tracking to the upgrade button */
      var upgradeBtn=results?results.querySelector('.pr-upgrade-btn'):null;
      if(upgradeBtn){upgradeBtn.addEventListener('click',function(){
        try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{url:url,source:'preview_results'}})],{type:'application/json'}));}catch(ex){}
      });}
      try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'preview_result_success',meta:{url:url,wordCount:p.wordCount||0,headingCount:(p.headings||[]).length,linkCount:(p.links||[]).length}})],{type:'application/json'}));}catch(ex){}
    }
    function onFail(err){
      var errMsg=String(err);
      var hint='';
      if(errMsg.indexOf('Failed to fetch')!==-1||errMsg.indexOf('AbortError')!==-1){
        hint='<p class="pr-hint">Network error \u2014 try opening the <a href="/v1/extract/preview?url='+encodeURIComponent(url)+'" target="_blank">raw JSON endpoint</a> directly.</p>';
      }
      if(results)results.innerHTML='<div class="pr-error">Preview failed: '+esc(errMsg)+' '+hint+'<a href="/v1/extract/preview?url='+encodeURIComponent(url)+'" target="_blank">Open raw JSON \u2197</a></div>';
      try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'preview_result_error',meta:{url:url,error:errMsg}})],{type:'application/json'}));}catch(ex){}
    }
    doPreviewFetch(url,1)
      .then(function(d){onSuccess(d);})
      .catch(function(err){
        /* Retry once on network error (e.g. ngrok tunnel hiccup) */
        if(String(err).indexOf('Failed to fetch')!==-1||String(err).indexOf('AbortError')!==-1){
          return new Promise(function(resolve){setTimeout(resolve,800);}).then(function(){
            return doPreviewFetch(url,2);
          }).then(function(d){onSuccess(d);}).catch(function(err2){onFail(err2);});
        }
        onFail(err);
      })
      .finally(function(){
        if(btn){btn.disabled=false;btn.textContent='Extract \u2197';}
      });
  });
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  /* --- CTA click tracking --- */
  document.querySelectorAll('.btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'cta_click',meta:{text:btn.textContent||'',href:btn.getAttribute('href')||''}})],{type:'application/json'}));}catch(ex){}
    });
  });
})();
</script>
</body>
</html>`;
}
