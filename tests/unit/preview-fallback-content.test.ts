/**
 * The HTTP-only preview fallback is the *primary* path of GET /v1/extract/preview
 * — the free surface an agent reads first to decide whether webcap is worth
 * paying for. It used to hand back every <p> on the page, so a cookie banner and
 * the footer counted as content. These tests pin the chrome removal, the
 * article/main scope choice, and the content provenance it reports.
 */
import { describe, expect, it } from 'vitest';
import { parseHtmlToStructure } from '../../src/capture/preview-fallback.js';

const ARTICLE_HTML = `<!doctype html>
<html>
  <head>
    <title>Fallback Title</title>
    <meta name="description" content="Fallback description." />
    <meta property="og:title" content="OG Fallback Title" />
  </head>
  <body>
    <header class="site-header"><nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav></header>
    <div><p>We use cookies to improve your experience. Accept all cookies.</p></div>
    <main>
      <article>
        <h1>Widgets explained</h1>
        <p>Widgets are small reusable parts worth reading about.</p>
        <h2>Composition</h2>
        <p>Second paragraph about composing widgets into larger systems.</p>
      </article>
    </main>
    <aside class="sidebar"><h2>Related</h2><p>Related links you do not need.</p></aside>
    <footer><p>Copyright 2026 Example Corp.</p><nav><a href="/terms">Terms</a></nav></footer>
  </body>
</html>`;

const MAIN_HTML = `<!doctype html><html><head><title>Main only</title></head><body><nav><a href="/x">x</a></nav><main><p>Main region content here.</p></main></body></html>`;

const BODY_HTML = `<!doctype html><html><head><title>Bare page</title></head><body><p>Only body content exists.</p></body></html>`;

describe('preview fallback: content-aware HTML parsing', () => {
  it('prefers the article region and drops structural chrome', () => {
    const s = parseHtmlToStructure(ARTICLE_HTML, 'https://example.com/post');
    expect(s.content?.source).toBe('article');
    expect(s.markdown).toContain('Widgets are small reusable parts worth reading about.');
    expect(s.markdown).toContain('# Widgets explained');
    expect(s.markdown).not.toContain('Accept all cookies');
    expect(s.markdown).not.toContain('Copyright 2026 Example Corp.');
    expect(s.markdown).not.toContain('Related links you do not need.');
    // Nav links are structural chrome: gone from links, which the paid extract
    // also reports as content-scoped.
    expect(s.links.map((l) => l.href)).not.toContain('https://example.com/pricing');
    // Meta still comes from <head>, outside the content scope.
    expect(s.title).toBe('OG Fallback Title');
    expect(s.description).toBe('Fallback description.');
  });

  it('falls back to <main> when there is no article, and to the document otherwise', () => {
    const withMain = parseHtmlToStructure(MAIN_HTML, 'https://example.com/');
    expect(withMain.content?.source).toBe('main');
    expect(withMain.markdown).toContain('Main region content here.');

    const bare = parseHtmlToStructure(BODY_HTML, 'https://example.com/');
    expect(bare.content?.source).toBe('body');
    expect(bare.markdown).toContain('Only body content exists.');
  });

  it('reports whole-page words separately from the content words it keeps', () => {
    const s = parseHtmlToStructure(ARTICLE_HTML, 'https://example.com/post');
    expect(s.wordCount).toBeGreaterThan(s.content?.words ?? 0);
    expect(s.content?.words).toBeGreaterThan(0);
    expect(s.content?.truncated).toBe(false);
  });

  it('treats list-based content as content', () => {
    const listy = `<!doctype html><html><head><title>Listy</title></head><body><main><ul><li>First item of substance.</li><li>Second item of substance.</li></ul></main></body></html>`;
    const s = parseHtmlToStructure(listy, 'https://example.com/');
    expect(s.markdown).toContain('First item of substance.');
    expect(s.markdown).toContain('Second item of substance.');
  });

  it('never previews a text page as empty when it has no <p> at all', () => {
    // Table/div layouts (Hacker News is one) used to preview with zero markdown,
    // because only <p> and headings were collected.
    const tabley = `<!doctype html><html><head><title>Tabley</title></head><body><nav><a href="/">nav</a></nav><table><tr><td>Story one headline</td></tr><tr><td>Story two headline</td></tr></table></body></html>`;
    const s = parseHtmlToStructure(tabley, 'https://example.com/');
    expect(s.markdown.length).toBeGreaterThan(0);
    expect(s.markdown).toContain('Story one headline');
    expect(s.markdown).not.toContain('nav');
    expect(s.content?.words).toBeGreaterThan(0);
  });

  it('does not swallow the document when a chrome tag is unclosed', () => {
    const broken = `<!doctype html><html><head><title>Broken</title></head><body><nav><a href="/a">a</a><p>Content after an unclosed nav must survive.</p></body></html>`;
    const s = parseHtmlToStructure(broken, 'https://example.com/');
    expect(s.markdown).toContain('Content after an unclosed nav must survive.');
  });
});
