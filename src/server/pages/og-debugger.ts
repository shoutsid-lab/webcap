/**
 * GET /og-debugger — the free OG meta debugger tool page. Any visitor pastes
 * a URL (?url=…, plain GET form so results are shareable/bookmarkable) and
 * sees what the free GET /v1/og endpoint returns for it: a link-preview card
 * plus a property → content tag table.
 *
 * No new fetch pipeline: the route calls the same deps.og service function as
 * the JSON endpoint. Every target-site value is esc()-escaped (XSS boundary),
 * <img src> renders only for http(s) image URLs, and the same fixed-window
 * rate limiter family as the preview route gates the fetch (limited callers
 * get a 200 page with an inline notice + paid CTA, never a fetch).
 */
import { DEFAULT_BAZAAR_CATALOG_URL, USDC_SCALE, type WebcapConfig } from '../../config.js';
import type { OgResult } from '../../capture/og.js';
import { footer, topBar } from './chrome.js';
import { BASE_CSS, OG_DEBUGGER_CSS } from './css.js';
import { esc } from './format.js';

/** What the debugger page renders: empty form, gated notice, inline error, or results. */
export type OgDebuggerData =
  | { readonly state: 'empty' }
  | { readonly state: 'rate_limited' }
  | { readonly state: 'error'; readonly rawUrl: string; readonly message: string }
  | { readonly state: 'ok'; readonly rawUrl: string; readonly result: OgResult };

/** Atomic 6-decimal USDC units -> "$0.001" (shortest decimal rendering). */
function usd(atomicUnits: number): string {
  return `$${atomicUnits / USDC_SCALE}`;
}

/** Only http(s) targets may become an <img src>; anything else gets the placeholder note. */
function safeImageUrl(image: string | undefined): string | undefined {
  if (image === undefined) return undefined;
  return /^https?:\/\//i.test(image) ? image : undefined;
}

function formCard(rawUrl: string | undefined): string {
  const value = rawUrl === undefined || rawUrl === '' ? '' : ` value="${esc(rawUrl)}"`;
  return `<div class="debug-form">
    <form method="get" action="/og-debugger">
      <label for="dbg-url">Page URL</label>
      <div class="url-row">
        <input id="dbg-url" type="url" name="url" inputmode="url" autocomplete="url"
          placeholder="https://example.com/" required${value}>
        <button class="btn" type="submit">Debug URL</button>
      </div>
      <p class="form-note">Plain GET form — results live at <code>/og-debugger?url=…</code>, shareable and bookmarkable.</p>
    </form>
  </div>`;
}

function previewCard(result: OgResult): string {
  const image = safeImageUrl(result.image);
  const title = result.title ?? 'No title found';
  const description = result.description ?? 'No description meta tag found on this page.';
  const media =
    image === undefined
      ? `<div class="og-ph" aria-hidden="true">no image</div>`
      : `<img src="${esc(image)}" alt="Open Graph image for ${esc(result.url)}" loading="lazy">`;
  return `<div class="og-card" aria-label="link preview">
    <div class="og-media">${media}</div>
    <div class="og-body">
      <p class="og-site">${esc(result.url)}</p>
      <p class="og-title">${esc(title)}</p>
      <p class="og-desc">${esc(description)}</p>
    </div>
  </div>`;
}

function tagTable(result: OgResult): string {
  const rows: Array<readonly [string, string]> = [];
  if (result.title !== undefined) rows.push(['og:title', result.title]);
  if (result.description !== undefined) rows.push(['og:description', result.description]);
  if (result.image !== undefined) rows.push(['og:image', result.image]);
  if (result.twitterCard !== undefined) rows.push(['twitter:card', result.twitterCard]);
  if (result.twitterSite !== undefined) rows.push(['twitter:site', result.twitterSite]);
  if (result.twitterCreator !== undefined) rows.push(['twitter:creator', result.twitterCreator]);
  if (result.twitterTitle !== undefined) rows.push(['twitter:title', result.twitterTitle]);
  if (result.twitterDescription !== undefined) rows.push(['twitter:description', result.twitterDescription]);
  if (result.twitterImage !== undefined) rows.push(['twitter:image', result.twitterImage]);
  if (result.articlePublishedTime !== undefined) rows.push(['article:published_time', result.articlePublishedTime]);
  if (result.articleAuthor !== undefined) rows.push(['article:author', result.articleAuthor]);
  if (result.articleSection !== undefined) rows.push(['article:section', result.articleSection]);
  if (result.articleTags !== undefined) {
    for (const tag of result.articleTags) rows.push(['article:tag', tag]);
  }
  if (result.icon !== undefined) rows.push(['icon', result.icon]);
  rows.push(['url', result.url]);
  const body = rows
    .map(([prop, content]) => `<tr><th scope="row">${esc(prop)}</th><td>${esc(content)}</td></tr>`)
    .join('');
  return `<div class="tag-wrap"><table class="og-tags" aria-label="meta tags">
    <thead><tr><th scope="col">property</th><th scope="col">content</th></tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function ctaBand(config: WebcapConfig): string {
  const capturePrice = usd(config.x402PriceUsdcUnits);
  const extractPrice = usd(config.x402ExtractPriceUsdcUnits);
  const auditPrice = usd(config.x402AuditPriceUsdcUnits);
  return `<section class="cta-band" aria-label="paid API">
    <p class="eyebrow">Need this at scale?</p>
    <h2>One paid call returns the screenshot, the structure, or the audit.</h2>
    <p class="hint">The debugger above is the free sample. The paid endpoints run the same
      pipeline per URL over x402 USDC micropayments — no API keys, no accounts, gasless.</p>
    <div class="dbg-links">
      <a href="/#pricing"><b>Capture — ${esc(capturePrice)} / URL</b><span><code>POST /v1/x402/capture</code>: PNG / JPEG / PDF screenshot + free OG metadata</span></a>
      <a href="/#pricing"><b>Extract — ${esc(extractPrice)} / batch</b><span><code>POST /v1/x402/extract</code>: title, headings, paragraphs, links, images, markdown</span></a>
      <a href="/#pay"><b>Audit — ${esc(auditPrice)} / URL</b><span><code>POST /v1/x402/audit</code>: SEO basics + link / OG health in one call</span></a>
    </div>
  </section>`;
}

export function ogDebuggerHtml(config: WebcapConfig, data: OgDebuggerData): string {
  const bazaarCatalogUrl = config.bazaarCatalogUrl ?? DEFAULT_BAZAAR_CATALOG_URL;
  const rawUrl = data.state === 'error' || data.state === 'ok' ? data.rawUrl : undefined;

  let result = '';
  if (data.state === 'rate_limited') {
    result = `<div class="alert" role="alert"><b>Rate limit reached.</b>
      <p>Free debugging is rate-limited per client. Retry in a minute, sample the
      bounded <a href="/v1/extract/preview?url=https://example.com/">extract preview</a> instead,
      or skip the queue with the paid API below — same pipeline, no limits.</p></div>`;
  } else if (data.state === 'error') {
    result = `<div class="alert" role="alert"><b>Could not debug that URL.</b>
      <p>could not fetch <code>${esc(data.rawUrl)}</code>: ${esc(data.message)}</p></div>`;
  } else if (data.state === 'ok') {
    result = `${previewCard(data.result)}<h3 class="sub-h">Tags found</h3>${tagTable(data.result)}`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OG meta debugger — webcap</title>
<meta name="description" content="Free Open Graph debugger: paste any URL and see its title, description, image and meta tags as a link preview — plus the paid screenshot, extract and audit API.">
<link rel="icon" href="/icon.png">
<style>${BASE_CSS}${OG_DEBUGGER_CSS}</style>
</head>
<body>
${topBar(bazaarCatalogUrl)}
<main class="wrap debug-main">
  <p class="crumb"><a href="/">webcap</a> / tools / og-debugger</p>
  <p class="kicker"><span class="rec">●</span> Free tool — no payment, no keys</p>
  <h1>OG meta debugger.</h1>
  <p class="hint">Paste any public URL and see exactly what
    <code>GET /v1/og?url=…</code> returns for it — the link preview card plus every
    tag. Free, rate-limited, no payment.</p>
  ${formCard(rawUrl)}
  ${result}
  ${ctaBand(config)}
</main>
${footer(bazaarCatalogUrl)}
</body>
</html>`;
}
