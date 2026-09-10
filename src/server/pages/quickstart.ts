/**
 * GET /quickstart — developer-friendly quick start guide.
 * Walks users through the x402 payment flow with copy-paste ready commands.
 * Goal: reduce the cognitive barrier between "I want to try this" and "I paid and got a result."
 */
import type { WebcapConfig } from '../../config.js';
import { USDC_SCALE } from '../../config.js';
import { footer, topBar } from './chrome.js';
import { BASE_CSS, LANDING_CSS } from './css.js';
import { esc } from './format.js';

function usd(units: number): string { return `$${units / USDC_SCALE}`; }

export function quickstartHtml(config: WebcapConfig): string {
  const base = config.publicBaseUrl;
  const capturePrice = usd(config.x402PriceUsdcUnits);
  const extractPrice = usd(config.x402ExtractPriceUsdcUnits);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quick Start \u2014 webcap</title>
<meta name="description" content="Get started with webcap in 3 steps. Screenshot any URL or extract structured data with a single curl command. Pay per call with USDC on Base.">
<link rel="icon" href="/icon.png">
<style>${BASE_CSS}${LANDING_CSS}
.qs-main{padding:88px 0 72px;max-width:800px}
.qs-main h1{font-size:clamp(30px,4.6vw,46px);letter-spacing:-.025em;font-weight:800;margin-top:20px}
.qs-main h1 .hl{color:var(--accent)}
.qs-main .lede{color:var(--muted);font-size:clamp(16px,1.8vw,18px);max-width:58ch;margin-top:20px;line-height:1.65}
.qs-section{margin-top:var(--s7)}
.qs-section h2{font-size:22px;font-weight:700;letter-spacing:-.02em;margin-bottom:var(--s3);display:flex;align-items:center;gap:10px}
.qs-section h2 .num{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;font-family:var(--mono);font-size:14px;font-weight:700;flex-shrink:0}
.qs-section p{color:var(--muted);font-size:15px;line-height:1.65;margin-top:var(--s3)}
.qs-section p code{font-size:13px}
.qs-section ul{margin:var(--s3) 0;padding-left:0;list-style:none}
.qs-section li{padding:6px 0;color:var(--muted);font-size:14px;line-height:1.6}
.qs-section li::before{content:"\\2713 ";color:var(--ok);font-weight:700}
.qs-tip{margin-top:var(--s4);padding:16px 20px;background:var(--accent-soft);border:1px solid rgba(37,99,235,.2);border-radius:var(--r-m);font-size:14px;color:var(--text);line-height:1.6}
.qs-tip strong{color:var(--accent)}
.qs-links{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s3);margin-top:var(--s5)}
@media(max-width:640px){.qs-links{grid-template-columns:1fr}}
.qs-links a{border:1px solid var(--line);border-radius:var(--r-m);padding:18px;color:var(--text);background:var(--panel);display:block;box-shadow:var(--shadow-card);transition:all .15s ease;text-decoration:none}
.qs-links a:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:var(--shadow);text-decoration:none}
.qs-links b{display:block;font-family:var(--mono);font-size:14px;font-weight:700}
.qs-links span{display:block;color:var(--muted);font-size:13px;margin-top:4px}
.qs-wallet{margin-top:var(--s5);padding:20px 24px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);box-shadow:var(--shadow-card)}
.qs-wallet h3{font-size:16px;font-weight:700;margin-bottom:var(--s3)}
.qs-wallet ol{margin:0;padding-left:20px;counter-reset:wallet-step}
.qs-wallet li{padding:4px 0;color:var(--muted);font-size:14px;line-height:1.6}
.qs-wallet li code{font-size:12px}
</style>
</head>
<body>
${topBar('', 'quickstart')}
<script>
try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'landing_view',meta:{referrer:document.referrer||'direct',page:'quickstart'}})],{type:'application/json'}));}catch(ex){}
</script>
<main class="wrap qs-main">
  <p class="eyebrow">Developer guide</p>
  <h1>Quick Start: <span class="hl">Capture the web in 3 steps</span></h1>
  <p class="lede">No API keys. No accounts. Just HTTP calls. Pay ${capturePrice}/screenshot or ${extractPrice}/extract with crypto (USDC on Base, gasless). No wallet? <a href="/buy">Buy credits with email</a>.</p>

  <!-- STEP 1: Try the free preview -->
  <section class="qs-section">
    <h2><span class="num">1</span> Try the free preview (no payment)</h2>
    <p>See what webcap extracts from any URL — completely free, no wallet needed:</p>
    <div class="term" aria-label="Free preview command">
      <div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">terminal</span></div>
      <pre><code><span class="c"># Free preview — no payment required</span>
curl "${base}/v1/extract/preview?url=https://example.com/"
<span class="ok">\u2192 200</span> {"preview":{"title":"Example Domain","headings":[...],"links":[...]},"truncated":true}</code></pre>
    </div>
    <div class="qs-tip"><strong>Tip:</strong> The preview is truncated — you get headings, links, and a markdown slice. The full extract (step 2) gives you everything including OG tags, full markdown, and batch support for up to 50 URLs.</div>
  </section>

  <!-- LIVE DEMO: Show what the full extract looks like -->
  <section class="qs-section">
    <h2>See what a full extract gives you</h2>
    <p>Here's the actual output from a single ${extractPrice} extract call — this is the real data you get, not a simulation:</p>
    <div id="qs-demo-area" style="margin-top:var(--s4)">
      <div class="term" aria-label="Full extract demo output">
        <div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">extract output — Hacker News (real data)</span></div>
        <pre id="qs-demo-code" style="max-height:400px;overflow-y:auto"><code>Loading demo\u2026</code></pre>
      </div>
      <div style="margin-top:var(--s3);display:flex;gap:var(--s3);flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><span style="color:var(--ok);font-weight:700">\u2713</span> All headings (not truncated)</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><span style="color:var(--ok);font-weight:700">\u2713</span> All links with text</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><span style="color:var(--ok);font-weight:700">\u2713</span> Full markdown</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><span style="color:var(--ok);font-weight:700">\u2713</span> Paragraphs</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><span style="color:var(--ok);font-weight:700">\u2713</span> Images</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)"><span style="color:var(--ok);font-weight:700">\u2713</span> Word count</div>
      </div>
    </div>
    <script>
    (function(){
      var el=document.getElementById('qs-demo-code');
      if(!el)return;
      fetch('/v1/demo').then(function(r){return r.json();}).then(function(d){
        var r=(d.results||[])[0];
        if(!r){el.textContent='Demo unavailable';return;}
        var out='';
        out+='URL: '+r.url+'\n';
        out+='Title: '+r.title+'\n';
        out+='Description: '+(r.description||'').slice(0,120)+'\n\n';
        out+='Headings ('+((r.headings||[]).length)+'):\n';
        (r.headings||[]).slice(0,8).forEach(function(h){out+='  H'+h.level+': '+h.text+'\n';});
        out+='\nLinks ('+((r.links||[]).length)+'):\n';
        (r.links||[]).slice(0,8).forEach(function(l){out+='  '+(l.text||'').slice(0,40)+' \u2192 '+l.href.slice(0,60)+'\n';});
        out+='\nParagraphs ('+((r.paragraphs||[]).length)+'):\n';
        (r.paragraphs||[]).slice(0,3).forEach(function(p){out+='  '+p.slice(0,100)+'...\n';});
        out+='\nWord count: '+r.wordCount+'\n';
        out+='Images: '+(r.images||[]).length+'\n';
        out+='Classification: '+(r.classification?r.classification.type+' ('+Math.round(r.classification.confidence*100)+'%)':'N/A')+'\n';
        out+='\n--- Full markdown (first 300 chars) ---\n';
        out+=(r.markdown||'').slice(0,300)+'...\n';
        el.textContent=out;
      }).catch(function(){el.textContent='Demo unavailable.';});
    })();
    </script>

  <!-- STEP 2: Make a paid request -->
  <section class="qs-section">
    <h2><span class="num">2</span> Make a paid request (x402)</h2>
    <p>Call the paid endpoint. The server responds with <strong>HTTP 402</strong> containing a payment challenge:</p>
    <div class="term" aria-label="Step 2: x402 challenge">
      <div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">terminal \u2014 extract</span></div>
      <pre><code><span class="c"># Step 2a: Send request, get 402 challenge</span>
curl -si -X POST "${base}/v1/x402/extract" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"urls":["https://example.com/"]}'</span>
<span class="k">\u2192 402</span> Payment Required
   x-pay-providers-response: {"x402Version":2,"accepts":[{...}],...}</code></pre>
    </div>
    <p>Now sign the payment with your wallet:</p>
    <div class="term" aria-label="Step 2b: Sign payment">
      <div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">terminal \u2014 sign payment</span></div>
      <pre><code><span class="c"># Step 2b: Sign the EIP-3009 transfer (gasless, no ETH needed)</span>
<span class="c"># Your x402 client signs a transferWithAuthorization:</span>
<span class="c">#   from: your wallet</span>
<span class="c">#   to: merchant wallet</span>
<span class="c">#   value: ${config.x402ExtractPriceUsdcUnits} (= ${extractPrice})</span>
<span class="c">#   asset: USDC on Base</span>

<span class="c"># Step 2c: Retry with payment header</span>
curl -si -X POST "${base}/v1/x402/extract" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -H <span class="s">'PAYMENT-SIGNATURE: &lt;your-signed-header&gt;'</span> \\
  -d <span class="s">'{"urls":["https://example.com/"]}'</span>
<span class="ok">\u2192 200</span> {"results":[{"url":"https://example.com/","title":"Example Domain","markdown":"# Example Domain\\n..."}]}</code></pre>
    </div>
  </section>

  <!-- STEP 3: Use a client library -->
  <section class="qs-section">
    <h2><span class="num">3</span> Use a client library (recommended)</h2>
    <p>Most developers don't sign x402 challenges manually. Use a client library that handles the flow automatically:</p>
    <div class="term" aria-label="Client library usage">
      <div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">JavaScript / TypeScript</span></div>
      <pre><code><span class="c"># Install the x402 client</span>
npm install @x402/axios

<span class="c"># Use it with any HTTP client</span>
import { wrapAxiosWithPayment } from '@x402/axios';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount('0x...');  <span class="c">// your private key</span>
const client = wrapAxiosWithPayment(axios, { account });

<span class="c"># Now make requests — payment is automatic</span>
const { data } = await client.post('${base}/v1/x402/extract', {
  urls: ['https://example.com/']
});
console.log(data.results[0].markdown);</code></pre>
    </div>
    <div class="qs-tip"><strong>What you need:</strong> A wallet with USDC on Base (even a few cents is enough for dozens of calls). No ETH gas needed \u2014 x402 uses gasless EIP-3009 transfers. Get test USDC on Base Sepolia from a faucet.</div>
  </section>

  <!-- Wallet setup -->
  <section class="qs-section">
    <h2>Set up your wallet</h2>
    <div class="qs-wallet">
      <h3>Quick wallet checklist</h3>
      <ul style="list-style:none;padding:0;margin:0">
        <li style="padding:6px 0;color:var(--muted);font-size:14px"><span style="color:var(--ok);font-weight:700">\u2713</span> <strong>Any EOA wallet</strong> (MetaMask, Rabby, Frame, etc.)</li>
        <li style="padding:6px 0;color:var(--muted);font-size:14px"><span style="color:var(--ok);font-weight:700">\u2713</span> <strong>USDC on Base</strong> network (chain ID 8453)</li>
        <li style="padding:6px 0;color:var(--muted);font-size:14px"><span style="color:var(--ok);font-weight:700">\u2713</span> <strong>No ETH needed</strong> \u2014 x402 transfers are gasless</li>
        <li style="padding:6px 0;color:var(--muted);font-size:14px"><span style="color:var(--ok);font-weight:700">\u2713</span> <strong>${extractPrice} per extract call</strong> (batch up to 50 URLs)</li>
        <li style="padding:6px 0;color:var(--muted);font-size:14px"><span style="color:var(--ok);font-weight:700">\u2713</span> <strong>${capturePrice} per screenshot</strong> (PNG/JPEG/PDF)</li>
      </ul>
    </div>
  </section>

  <!-- Links -->
  <section class="qs-section">
    <h2>Next steps</h2>
    <div class="qs-links">
      <a href="/openapi.json"><b>OpenAPI spec</b><span>Full API reference with all endpoints, schemas, and examples.</span></a>
      <a href="/compare"><b>vs alternatives</b><span>How webcap compares to screenshot APIs and data extraction services.</span></a>
      <a href="https://github.com/shoutsid-lab/webcap" target="_blank" rel="noopener"><b>GitHub</b><span>Source code, issues, and contributions.</span></a>
    </div>
  </section>
</main>
${footer('')}
</body>
</html>`;
}
