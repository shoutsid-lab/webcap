/**
 * The webcap public web surfaces: the product landing page (GET /) and the
 * shareable artifact page (GET /v1/artifacts/:id/page).
 *
 * Design system: there is no separate frontend, so the token system lives in
 * ./pages/css.ts as CSS custom properties (BASE_CSS) shared verbatim by both
 * pages — both surfaces render from the same palette, spacing scale, type
 * scale and component primitives (top bar, panels, code terminal, buttons,
 * meta grid). No frameworks, no external assets, no JavaScript.
 *
 * The landing document builder, its chain-conditional copy, the CSS blocks,
 * the shared chrome, and the text helpers live in ./pages/{landing,copy,
 * css,chrome,format}.ts. landingHtml is re-exported here so existing import
 * sites (routes/discovery, tests) are unchanged.
 *
 * All user-influenced values (source URLs, ids, formats, timestamps) pass
 * through esc() before interpolation.
 */
import { DEFAULT_BAZAAR_CATALOG_URL, type WebcapConfig } from '../config.js';
import type { ArtifactRow } from '../db/artifacts.js';
import { footer, topBar } from './pages/chrome.js';
import { ARTIFACT_CSS, BASE_CSS } from './pages/css.js';
import { esc, formatBytes, readableCapturedAt } from './pages/format.js';

export { landingHtml } from './pages/landing.js';

// ---------------------------------------------------------------------------
// GET /v1/artifacts/:id/page — shareable artifact page
// ---------------------------------------------------------------------------

export function artifactPageHtml(config: WebcapConfig, artifact: ArtifactRow): string {
  const sourceUrl = artifact.source_url;
  const bazaarCatalogUrl = config.bazaarCatalogUrl ?? DEFAULT_BAZAAR_CATALOG_URL;
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
${topBar(bazaarCatalogUrl)}
<main class="wrap artifact-main">
  <p class="crumb"><a href="/">webcap</a> / capture / <code>${esc(artifact.id)}</code></p>
  <div class="artifact-head">
  <h1>Capture of <a href="${esc(sourceUrl)}" target="_blank" rel="noopener">${esc(sourceUrl)}</a></h1>
  <div class="artifact-actions"><a class="primary" href="${esc(publicUrl)}">Download raw ${esc(artifact.format)}</a><a href="/">← back to webcap</a></div>
  </div>
  <figure class="frame">
    <img src="${esc(publicUrl)}" alt="Screenshot of ${esc(sourceUrl)}" width="1200" loading="eager">
  </figure>
  <dl class="meta">
    <div><dt>format</dt><dd>${esc(artifact.format)}</dd></div>
    <div><dt>size</dt><dd>${formatBytes(artifact.bytes.length)}</dd></div>
    <div><dt>captured</dt><dd>${esc(readableCapturedAt(artifact.created_at))}</dd></div>
  </dl>
  <p class="get"><a href="${esc(publicUrl)}">Download raw ${esc(artifact.format)}</a>
    &nbsp;·&nbsp; <a href="/">← back to webcap</a></p>
</main>
${footer(bazaarCatalogUrl)}
</body>
</html>`;
}
