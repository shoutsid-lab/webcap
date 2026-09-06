/**
 * The page chrome shared by the landing page and the artifact page: the top
 * bar (brand + nav) and the footer. Split out of pages.ts as a pure move (no
 * behavior change) — the served HTML is byte-identical.
 */

function topBar(bazaarCatalogUrl: string): string {
  return `<div class="top"><div class="wrap">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>webcap</a>
  <nav>
    <a href="/openapi.json">openapi.json</a>
    <a href="${bazaarCatalogUrl}" target="_blank" rel="noopener">CDP Bazaar</a>
    <a href="/icon.png">icon.png</a>
  </nav>
</div></div>`;
}

function footer(bazaarCatalogUrl: string): string {
  return `<footer><div class="wrap"><div class="foot-row">
  <span>webcap — pay-per-call web capture. No keys, no accounts, USDC over x402.</span>
  <span><a href="/">landing</a> · <a href="/openapi.json">OpenAPI</a> · <a href="${bazaarCatalogUrl}" target="_blank" rel="noopener">Bazaar</a> · <a href="/icon.png">icon</a></span>
</div></div></footer>`;
}

export { footer, topBar };
