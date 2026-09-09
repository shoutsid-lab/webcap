/**
 * GET /compare — pricing comparison page showing webcap vs alternatives.
 * This is a standalone server-rendered page that compares webcap's pay-per-call
 * x402 pricing against popular SaaS screenshot/API services.
 */
import { DEFAULT_BAZAAR_CATALOG_URL, USDC_SCALE, type WebcapConfig } from '../../config.js';
import { footer, topBar } from './chrome.js';
import { BASE_CSS, LANDING_CSS } from './css.js';
import { esc } from './format.js';

function usd(atomicUnits: number): string {
  return `$${atomicUnits / USDC_SCALE}`;
}

export function compareHtml(config: WebcapConfig): string {
  const bazaarCatalogUrl = config.bazaarCatalogUrl ?? DEFAULT_BAZAAR_CATALOG_URL;
  const capturePrice = usd(config.x402PriceUsdcUnits);
  const extractPrice = usd(config.x402ExtractPriceUsdcUnits);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>webcap vs alternatives \u2014 pricing comparison (10-100x cheaper)</title>
<meta name="description" content="Compare webcap pay-per-call pricing against Urlbox, ScreenshotAPI, Screenshotone, and other screenshot APIs. webcap starts at $0.001/capture \u2014 10-100x cheaper than SaaS alternatives.">
<meta property="og:title" content="webcap vs alternatives \u2014 pricing comparison">
<meta property="og:description" content="Compare webcap pay-per-call pricing against Urlbox, ScreenshotAPI, and other screenshot APIs. 10-100x cheaper with x402 USDC micropayments.">
<meta property="og:type" content="website">
<meta property="og:url" content="${config.publicBaseUrl}/compare">
<meta property="og:image" content="${config.publicBaseUrl}/icon.png">
<link rel="canonical" href="${config.publicBaseUrl}/compare">
<link rel="icon" href="/icon.png">
<style>${BASE_CSS}${LANDING_CSS}</style>
</head>
<body>
${topBar(bazaarCatalogUrl)}
<main class="wrap compare-main">
  <p class="kicker"><span class="rec">\u25CF</span> Pricing comparison</p>
  <h1>webcap <span class="hl">vs alternatives</span></h1>
  <p class="lede">webcap is a pay-per-call web capture API using x402 USDC micropayments. No accounts,
    no API keys, no subscriptions \u2014 just pay per call at a fraction of the cost of traditional SaaS screenshot services.</p>

  <div class="compare-table-wrap">
    <table class="compare-table">
      <thead>
        <tr>
          <th>Service</th>
          <th>Screenshot price</th>
          <th>Extract price</th>
          <th>Payment</th>
          <th>Accounts</th>
          <th>Self-serve</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th>webcap</th>
          <td class="col-webcap">${esc(capturePrice)}/call</td>
          <td class="col-webcap">${esc(extractPrice)}/batch</td>
          <td class="col-webcap">x402 USDC (gasless)</td>
          <td class="col-webcap">None</td>
          <td class="col-webcap">\u2713 Instant</td>
        </tr>
        <tr>
          <th>Urlbox</th>
          <td>$0.02\u20130.10/shot</td>
          <td>N/A</td>
          <td>Credit card / Stripe</td>
          <td>Required</td>
          <td>Free tier (limited)</td>
        </tr>
        <tr>
          <th>ScreenshotAPI</th>
          <td>$0.01\u20130.05/shot</td>
          <td>N/A</td>
          <td>Credit card / Stripe</td>
          <td>Required</td>
          <td>Free tier (100/mo)</td>
        </tr>
        <tr>
          <th>Screenshotone</th>
          <td>$0.01\u20130.04/shot</td>
          <td>N/A</td>
          <td>Credit card / Stripe</td>
          <td>Required</td>
          <td>Free tier (limited)</td>
        </tr>
        <tr>
          <th>Browserless</th>
          <td>$0.01/shot (pay-as-you-go)</td>
          <td>N/A</td>
          <td>Credit card / Stripe</td>
          <td>Required</td>
          <td>Free tier (limited)</td>
        </tr>
        <tr>
          <th>Blokt / api.flash</th>
          <td>$0.005\u20130.02/shot</td>
          <td>N/A</td>
          <td>Credit card / Stripe</td>
          <td>Required</td>
          <td>Free tier (limited)</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="compare-highlight">
    <h3>webcap is 10\u2013100x cheaper per capture</h3>
    <p>At <strong>${esc(capturePrice)}/capture</strong>, webcap costs a fraction of traditional SaaS alternatives.
      No monthly subscriptions, no credit packs, no hidden fees \u2014 just pay per call with USDC over x402.
      Gasless transactions mean you never need ETH for gas.</p>
    <a class="btn" href="#preview">Try it now \u2193</a>
  </div>

  <h2 style="margin-top:48px">Why pay-per-call beats subscriptions</h2>
  <div class="price-grid" style="margin-top:20px">
    <div class="price">
      <h3>Pay only for what you use</h3>
      <p>No minimums, no monthly fees. Capture 5 URLs one week, 5,000 the next \u2014 you only pay for actual usage.</p>
    </div>
    <div class="price">
      <h3>No accounts or API keys</h3>
      <p>Connect your USDC wallet and start calling. No sign-up forms, no email verification, no API key management.</p>
    </div>
    <div class="price">
      <h3>On-chain settlement</h3>
      <p>Every payment is an EIP-3009 transfer settled on Base. Fully transparent, auditable, censorship-resistant.</p>
    </div>
  </div>

  <h2 style="margin-top:48px">Cost examples</h2>
  <p class="hint" style="margin-top:12px">Real-world scenarios comparing webcap to average SaaS pricing ($0.02/shot midpoint).</p>
  <div class="price-grid" style="margin-top:20px">
    <div class="price">
      <h3>100 captures/month</h3>
      <div class="amount" style="font-size:28px">$${(config.x402PriceUsdcUnits * 100 / USDC_SCALE).toFixed(2)} <small>webcap</small></div>
      <p style="margin-top:8px">vs ~$2.00/mo with SaaS alternatives</p>
    </div>
    <div class="price featured">
      <span class="flag">Save 95%+</span>
      <h3>1,000 captures/month</h3>
      <div class="amount" style="font-size:28px">$${(config.x402PriceUsdcUnits * 1000 / USDC_SCALE).toFixed(2)} <small>webcap</small></div>
      <p style="margin-top:8px">vs ~$20.00/mo with SaaS alternatives</p>
    </div>
    <div class="price">
      <h3>10,000 captures/month</h3>
      <div class="amount" style="font-size:28px">$${(config.x402PriceUsdcUnits * 10000 / USDC_SCALE).toFixed(2)} <small>webcap</small></div>
      <p style="margin-top:8px">vs ~$200.00/mo with SaaS alternatives</p>
    </div>
  </div>

  <p class="compare-note">Prices reflect publicly listed rates as of September 2025. Actual competitor pricing may vary by plan tier, volume discounts, or promotional offers. webcap prices are flat per-call with no volume tiers needed.</p>
</main>
${footer(bazaarCatalogUrl)}
</body>
</html>`;
}
