/**
 * GET /buy — credit pack purchase page.
 * Shows the three credit packs (starter/pro/max) with BUY BUTTONS that
 * actually initiate payment via Stripe Checkout (when configured) or
 * show a fallback email-based purchase request.
 *
 * The goal: convert free preview users into paying customers.
 * Previous version had ZERO purchase buttons — this version fixes that.
 */
import { DEFAULT_BAZAAR_CATALOG_URL, USDC_SCALE, type WebcapConfig } from '../../config.js';
import { PACKS } from '../../config/pricing.js';
import { footer, topBar } from './chrome.js';
import { BASE_CSS, LANDING_CSS } from './css.js';
import { esc } from './format.js';

function usd(cents: number): string {
  return `$${cents.toFixed(cents % 1 === 0 ? 0 : 2)}`;
}

export function buyHtml(config: WebcapConfig): string {
  const base = config.publicBaseUrl;
  const bazaarCatalogUrl = config.bazaarCatalogUrl ?? DEFAULT_BAZAAR_CATALOG_URL;
  const capturePrice = `$${config.x402PriceUsdcUnits / USDC_SCALE}`;
  const extractPrice = `$${config.x402ExtractPriceUsdcUnits / USDC_SCALE}`;
  const stripeConfigured = !!config.stripeSecretKey;

  const starter = PACKS.starter;
  const pro = PACKS.pro;
  const max = PACKS.max;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Buy Credits \u2014 webcap</title>
<meta name="description" content="Buy webcap API credits. Pay per call with no subscriptions. Starter $0.50 (100 credits), Pro $3 (1000 credits), Max $12 (10,000 credits).">
<meta property="og:title" content="Buy Credits \u2014 webcap">
<meta property="og:description" content="Pay-per-call web capture credits. $0.001/screenshot, $0.01/extraction. No subscriptions.">
<meta property="og:type" content="website">
<meta property="og:url" content="${base}/buy">
<meta property="og:image" content="${base}/icon.png">
<link rel="canonical" href="${base}/buy">
<link rel="icon" href="/icon.png">
<style>${BASE_CSS}${LANDING_CSS}
.buy-main{padding:88px 0 72px;max-width:960px}
.buy-main h1{font-size:clamp(30px,4.6vw,46px);letter-spacing:-.025em;font-weight:800;margin-top:20px}
.buy-main h1 .hl{color:var(--accent)}
.buy-main .lede{color:var(--muted);font-size:clamp(16px,1.8vw,18px);max-width:58ch;margin-top:20px;line-height:1.65}
.buy-packs{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s4);margin-top:var(--s6)}
@media(max-width:720px){.buy-packs{grid-template-columns:1fr}}
.buy-pack{border:1px solid var(--line);border-radius:var(--r-l);padding:32px 28px;background:var(--panel);box-shadow:var(--shadow-card);transition:all .2s ease;position:relative;display:flex;flex-direction:column}
.buy-pack:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:var(--shadow)}
.buy-pack.popular{border-color:var(--accent);box-shadow:0 2px 4px rgba(0,0,0,.06),0 8px 24px rgba(37,99,235,.12)}
.buy-pack.popular::before{content:"Most popular";position:absolute;top:-12px;left:24px;background:var(--accent);color:#fff;font-size:12px;font-weight:700;padding:3px 12px;border-radius:20px;letter-spacing:.02em}
.buy-pack h3{font-size:20px;font-weight:700;margin:0 0 8px}
.buy-pack .amount{font-size:36px;font-weight:800;color:var(--accent);letter-spacing:-.02em;line-height:1.2}
.buy-pack .amount small{font-size:16px;font-weight:400;color:var(--muted)}
.buy-pack .per-credit{font-size:13px;color:var(--faint);margin:4px 0 16px;font-family:var(--mono)}
.buy-pack ul{list-style:none;padding:0;margin:0 0 24px;flex:1}
.buy-pack li{padding:6px 0;color:var(--muted);font-size:14px;line-height:1.5}
.buy-pack li::before{content:"\\2713 ";color:var(--ok);font-weight:700}
.buy-pack .pack-btn{display:block;width:100%;text-align:center;margin-top:auto;padding:14px 24px;font-size:16px;font-weight:700;border-radius:var(--r-m);background:var(--accent);color:var(--accent-ink);border:1px solid var(--accent);cursor:pointer;text-decoration:none;transition:all .15s ease;box-shadow:0 2px 8px rgba(37,99,235,.25);font-family:var(--mono)}
.buy-pack .pack-btn:hover{filter:brightness(1.05);transform:translateY(-1px);box-shadow:0 4px 16px rgba(37,99,235,.35);text-decoration:none}
.buy-pack .pack-btn.loading{pointer-events:none;opacity:.7}
.pack-notify{margin-top:auto}
.pack-notify-form{display:flex;gap:0;border-radius:var(--r-m);overflow:hidden;border:1px solid var(--accent)}
.pack-notify-form input{flex:1;padding:12px 16px;border:none;font-size:14px;font-family:var(--mono);background:var(--bg);color:var(--text);min-width:0}
.pack-notify-form input:focus{outline:none;box-shadow:inset 0 0 0 2px var(--accent)}
.pack-notify-form .pack-btn{border-radius:0;border:none;padding:12px 20px;font-size:14px;font-weight:700;background:var(--accent);color:var(--accent-ink);cursor:pointer;font-family:var(--mono);white-space:nowrap}
.pack-notify-form .pack-btn:hover{filter:brightness(1.1)}
.pack-notify-note{margin-top:8px;font-size:12px;color:var(--faint);line-height:1.5}
.pack-notify-note a{color:var(--accent)}
.pack-notify-done{padding:16px;text-align:center;color:var(--ok);font-weight:600;font-size:14px}
.buy-section{margin-top:var(--s7)}
.buy-section h2{font-size:22px;font-weight:700;letter-spacing:-.02em;margin-bottom:var(--s3)}
.buy-section p{color:var(--muted);font-size:15px;line-height:1.65;margin-top:var(--s3)}
.buy-section code{font-size:13px}
.buy-terms{margin-top:var(--s7);padding:24px;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-l)}
.buy-terms h3{font-size:16px;font-weight:700;margin-bottom:var(--s3)}
.buy-terms table{width:100%;border-collapse:collapse;font-size:14px}
.buy-terms th,.buy-terms td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--line)}
.buy-terms th{color:var(--faint);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.buy-terms td{color:var(--muted)}
.buy-terms td:last-child{font-family:var(--mono);font-size:13px}
.buy-cta{margin-top:var(--s6);text-align:center}
.buy-cta .btn{font-size:16px;padding:14px 32px}
.term{margin-top:var(--s4);background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);overflow:hidden}
.term pre{padding:20px 24px;font-size:14px;line-height:1.7;overflow-x:auto;margin:0}
.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--line);border-radius:var(--r-m);padding:12px 24px;box-shadow:0 8px 24px rgba(0,0,0,.12);font-size:14px;z-index:1001;display:none}
.toast.show{display:block;animation:fadeIn .2s ease}
@keyframes fadeIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
</style>
</head>
<body>
${topBar(bazaarCatalogUrl, 'buy')}
<main class="wrap buy-main">
  <p class="eyebrow">Pricing</p>
  <h1>Buy credits. <span class="hl">Pay per call.</span></h1>
  <p class="lede">No subscriptions. No minimums. No accounts needed. Buy credits and use them for screenshots, extractions, and monitoring. Unused credits never expire.</p>

  <div class="buy-packs">
    <div class="buy-pack">
      <h3>Starter</h3>
      <div class="amount">${usd(starter.usd)}</div>
      <div class="per-credit">${starter.credits} credits &middot; $${(starter.usd / starter.credits).toFixed(4)}/credit</div>
      <ul>
        <li>${starter.credits} API credits</li>
        <li>~${starter.credits} screenshots OR ~${Math.floor(starter.credits / 1)} extractions</li>
        <li>Credits never expire</li>
      </ul>
      ${stripeConfigured
        ? `<button class="pack-btn" data-pack="starter" data-price="${usd(starter.usd)}" data-credits="${starter.credits}">Buy Starter \u2192</button>`
        : `<div class="pack-notify"><form class="pack-notify-form" data-pack="starter"><input type="email" placeholder="you@email.com" required aria-label="Email for Starter purchase"><button type="submit" class="pack-btn">Get Starter \u2192</button></form><p class="pack-notify-note">We'll email you a payment link within 24h. <a href="/quickstart">Or use x402 crypto now \u2197</a></p></div>`
      }
    </div>
    <div class="buy-pack popular">
      <h3>Pro</h3>
      <div class="amount">${usd(pro.usd)}</div>
      <div class="per-credit">${pro.credits.toLocaleString()} credits &middot; $${(pro.usd / pro.credits).toFixed(4)}/credit</div>
      <ul>
        <li>${pro.credits.toLocaleString()} API credits</li>
        <li>~${pro.credits.toLocaleString()} screenshots OR ~${Math.floor(pro.credits / 1)} extractions</li>
        <li>33% cheaper than Starter</li>
        <li>Credits never expire</li>
      </ul>
      ${stripeConfigured
        ? `<button class="pack-btn" data-pack="pro" data-price="${usd(pro.usd)}" data-credits="${pro.credits.toLocaleString()}">Buy Pro \u2192</button>`
        : `<div class="pack-notify"><form class="pack-notify-form" data-pack="pro"><input type="email" placeholder="you@email.com" required aria-label="Email for Pro purchase"><button type="submit" class="pack-btn">Get Pro \u2192</button></form><p class="pack-notify-note">We'll email you a payment link within 24h. <a href="/quickstart">Or use x402 crypto now \u2197</a></p></div>`
      }
    </div>
    <div class="buy-pack">
      <h3>Max</h3>
      <div class="amount">${usd(max.usd)}</div>
      <div class="per-credit">${max.credits.toLocaleString()} credits &middot; $${(max.usd / max.credits).toFixed(4)}/credit</div>
      <ul>
        <li>${max.credits.toLocaleString()} API credits</li>
        <li>~${max.credits.toLocaleString()} screenshots OR ~${Math.floor(max.credits / 1)} extractions</li>
        <li>60% cheaper than Starter</li>
        <li>Credits never expire</li>
      </ul>
      ${stripeConfigured
        ? `<button class="pack-btn" data-pack="max" data-price="${usd(max.usd)}" data-credits="${max.credits.toLocaleString()}">Buy Max \u2192</button>`
        : `<div class="pack-notify"><form class="pack-notify-form" data-pack="max"><input type="email" placeholder="you@email.com" required aria-label="Email for Max purchase"><button type="submit" class="pack-btn">Get Max \u2192</button></form><p class="pack-notify-note">We'll email you a payment link within 24h. <a href="/quickstart">Or use x402 crypto now \u2197</a></p></div>`
      }
    </div>
  </div>
  ${!stripeConfigured ? `
  <div style="text-align:center;margin-top:var(--s4);padding:12px 20px;background:rgba(37,99,235,.06);border:1px solid rgba(37,99,235,.15);border-radius:var(--r-m);font-size:13px;color:var(--muted)">
    \u{1F513} <strong>Card payments coming soon.</strong> Currently accepting email purchase requests and x402 crypto (USDC on Base).
  </div>` : ''}

  <section class="buy-section">
    <h2>What credits do</h2>
    <div class="term"><div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">credit usage</span></div>
    <pre><code><span class="c"># Screenshot: 1 credit = ${capturePrice}/capture</span>
POST /v1/x402/capture  {"url":"https://example.com"}

<span class="c"># Extract: ${Math.ceil(config.x402ExtractPriceUsdcUnits / config.x402PriceUsdcUnits)} credits = ${extractPrice}/batch</span>
POST /v1/x402/extract  {"urls":["https://a.com","https://b.com"]}

<span class="c"># Free preview: 0 credits (no payment needed)</span>
GET  /v1/extract/preview?url=https://example.com</code></pre></div>
  </section>

  <section class="buy-section">
    <h2>How to pay</h2>
    <p>Two payment methods, same API:</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s4);margin-top:var(--s4)">
      <div style="padding:20px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l)">
        <h3 style="font-size:16px;font-weight:700;margin:0 0 8px">\u{1F4B3} Card (Stripe)</h3>
        <p style="color:var(--muted);font-size:14px;line-height:1.6;margin:0">Pay with any credit or debit card via Stripe Checkout. Credits are added instantly. No crypto wallet needed.</p>
      </div>
      <div style="padding:20px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l)">
        <h3 style="font-size:16px;font-weight:700;margin:0 0 8px">\u{1F48E} Crypto (USDC)</h3>
        <p style="color:var(--muted);font-size:14px;line-height:1.6;margin:0">Pay with USDC on Base via x402. Gasless, no accounts needed. Sign a single EIP-3009 transfer from your wallet.</p>
      </div>
    </div>
  </section>

  <section class="buy-section">
    <h2>Quick start with x402</h2>
    <div class="term"><div class="term-bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="fname">terminal \u2014 x402 payment flow</span></div>
    <pre><code><span class="c"># 1. Make a request (no payment)</span>
curl -si -X POST "${base}/v1/x402/extract" \\
  -H <span class="s">'content-type: application/json'</span> \\
  -d <span class="s">'{"urls":["https://example.com"]}'</span>

<span class="k">\u2192 402</span> Payment Required
   x-pay-providers-response: {"x402Version":2,"accepts":[...]}

<span class="c"># 2. Sign the payment (EIP-3009, gasless)</span>
<span class="c"># Use @x402/axios for auto-payment:</span>

<span class="c"># npm install @x402/axios @x402/evm</span>
import { x402Client, wrapAxiosWithPayment } from <span class="s">'@x402/axios'</span>;
import { ExactEvmScheme } from <span class="s">'@x402/evm'</span>;
import { privateKeyToAccount } from <span class="s">'viem/accounts'</span>;

const payer = privateKeyToAccount(process.env.PAYER_KEY);
const client = new x402Client().register(<span class="s">'eip155:8453'</span>, new ExactEvmScheme(payer));
const api = wrapAxiosWithPayment(axios.create({ baseURL: <span class="s">'${base}'</span> }), client);

<span class="c"># 3. Get your result</span>
const { data } = await api.post(<span class="s">'/v1/x402/extract'</span>, { urls: [<span class="s">'https://example.com'</span>] });
console.log(data.results[0].title); <span class="c">// "Example Domain"</span></code></pre></div>
    <p>See the <a href="/quickstart">full quick start guide</a> for more details.</p>
  </section>

  <div class="buy-terms">
    <h3>Pricing breakdown</h3>
    <table>
      <thead>
        <tr><th>Endpoint</th><th>Price</th><th>Credits</th><th>What you get</th></tr>
      </thead>
      <tbody>
        <tr><td>POST /v1/x402/capture</td><td>${capturePrice}</td><td>1</td><td>Screenshot (PNG/JPEG/PDF) + OG metadata + persistent artifact URL</td></tr>
        <tr><td>POST /v1/x402/extract</td><td>${extractPrice}</td><td>${Math.ceil(config.x402ExtractPriceUsdcUnits / config.x402PriceUsdcUnits)}</td><td>Structured JSON (title, headings, links, markdown) \u2014 batch up to 50 URLs</td></tr>
        <tr><td>POST /v1/x402/audit</td><td>$${config.x402AuditPriceUsdcUnits / USDC_SCALE}</td><td>${Math.ceil(config.x402AuditPriceUsdcUnits / config.x402PriceUsdcUnits)}</td><td>SEO basics + link/OG health in one call</td></tr>
        <tr><td>POST /v1/x402/video</td><td>$${config.x402VideoPriceUsdcUnits / USDC_SCALE}</td><td>${Math.ceil(config.x402VideoPriceUsdcUnits / config.x402PriceUsdcUnits)}</td><td>Scroll-capture as MP4/WebM video</td></tr>
        <tr><td>GET /v1/extract/preview</td><td>Free</td><td>0</td><td>Bounded preview (title, headings, links, truncated markdown)</td></tr>
        <tr><td>GET /v1/og</td><td>Free</td><td>0</td><td>Open Graph metadata</td></tr>
      </tbody>
    </table>
  </div>

  <div class="buy-cta">
    <a class="btn" href="/" onclick="window.location='/'">Try the free preview first \u2192</a>
    <p style="margin-top:16px;color:var(--faint);font-size:14px">No credit card required. Try before you buy.</p>
  </div>
</main>
${footer(bazaarCatalogUrl)}

<div class="toast" id="toast"></div>

<script>
(function(){
  var base='${base}';
  var stripeConfigured=${stripeConfigured};

  function showToast(msg,dur){
    var t=document.getElementById('toast');
    if(!t)return;
    t.textContent=msg;t.className='toast show';
    setTimeout(function(){t.className='toast';},dur||3000);
  }

  function trackBuyClick(pack,price,source){
    try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'buy_click',meta:{pack:pack,price:price,source:source}})],{type:'application/json'}));}catch(ex){}
  }

  if(stripeConfigured){
    /* Stripe configured: use checkout flow */
    document.querySelectorAll('.pack-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        var pack=btn.getAttribute('data-pack')||'';
        var price=btn.getAttribute('data-price')||'';
        var credits=btn.getAttribute('data-credits')||'';
        trackBuyClick(pack,price,'buy_button');
        btn.textContent='Redirecting\u2026';
        btn.classList.add('loading');
        fetch('/v1/stripe/checkout',{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({pack:pack})
        }).then(function(r){
          if(!r.ok)throw new Error('HTTP '+r.status);
          return r.json();
        }).then(function(d){
          if(d.checkoutUrl){window.location=d.checkoutUrl;}
          else{btn.textContent='Buy '+pack.charAt(0).toUpperCase()+pack.slice(1)+' \u2192';btn.classList.remove('loading');showToast('Payment unavailable. Try x402 crypto.',3000);}
        }).catch(function(){
          btn.textContent='Buy '+pack.charAt(0).toUpperCase()+pack.slice(1)+' \u2192';btn.classList.remove('loading');
          showToast('Payment unavailable. Try x402 crypto.',3000);
        });
      });
    });
  } else {
    /* No Stripe: inline email-to-buy forms */
    document.querySelectorAll('.pack-notify-form').forEach(function(form){
      form.addEventListener('submit',function(e){
        e.preventDefault();
        var pack=form.getAttribute('data-pack')||'';
        var emailInput=form.querySelector('input[type="email"]');
        var email=emailInput?emailInput.value.trim():'';
        if(!email)return;
        trackBuyClick(pack,'','email_purchase_request');
        fetch('/v1/track',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'purchase_request',meta:{email:email,pack:pack,source:'buy_page_inline'}})}).catch(function(){});
        fetch('/v1/waitlist',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email})}).catch(function(){});
        /* Replace form with success message */
        var card=form.closest('.buy-pack');
        if(card){
          var btn=form.querySelector('button[type="submit"]');
          if(btn){btn.textContent='Sent!';btn.style.background='var(--ok)';btn.disabled=true;}
          emailInput.disabled=true;
          emailInput.style.opacity='0.6';
          var note=card.querySelector('.pack-notify-note');
          if(note){note.innerHTML='<span style="color:var(--ok)">Check your inbox for a payment link.</span>';}
        }
        showToast('Request sent! Check your email.',4000);
      });
    });
  }

  /* track page view */
  try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'buy_page_view',meta:{stripe:stripeConfigured}})],{type:'application/json'}));}catch(ex){}
  try{navigator.sendBeacon('/v1/track',new Blob([JSON.stringify({event:'upgrade_click',meta:{source:'buy_page'}})],{type:'application/json'}));}catch(ex){}
})();
</script>
</body>
</html>`;
}
