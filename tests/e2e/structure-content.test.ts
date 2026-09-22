/**
 * Content-aware structured extraction, against a real browser and a local
 * fixture page (no internet).
 *
 * The consumer of `paragraphs`/`markdown` is a machine reading the page into a
 * context window, so chrome (nav, cookie banner, sidebar, footer) must not be
 * part of what it pays for, and it must be able to cap the size.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { closeBrowser } from '../../src/capture/browser.js';
import { captureStructured } from '../../src/capture/pipeline.js';

const ARTICLE_HTML = `<!doctype html>
<html>
  <head>
    <title>Widgets explained</title>
    <meta name="description" content="A short guide to widgets." />
  </head>
  <body>
    <header class="site-header">
      <nav><a href="/">Home</a><a href="/pricing">Pricing</a><a href="/blog">Blog</a></nav>
    </header>
    <div class="cookie-banner"><p>We use cookies to improve your experience. Accept all cookies.</p></div>
    <main>
      <article>
        <h1>Widgets explained</h1>
        <p>Widgets are small reusable parts. This is the real content a machine should read.</p>
        <h2>How widgets work</h2>
        <ul><li>They compose.</li><li>They stay small.</li></ul>
        <p>Second content paragraph describing widget composition in more detail for the reader.</p>
        <img src="/px.png" alt="widget diagram" />
      </article>
    </main>
    <aside class="sidebar"><h2>Related</h2><p>Related links you probably do not need.</p><a href="/story">Story A</a></aside>
    <footer><p>Copyright 2026 Example Corp.</p><nav><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav></footer>
  </body>
</html>`;

const BARE_HTML = `<!doctype html><html><head><title>Bare</title></head><body><p>Just one paragraph of text with no containers at all.</p></body></html>`;

describe('content-aware extraction (local http fixture, no internet)', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/px.png') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
          ),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(req.url === '/bare' ? BARE_HTML : ARTICLE_HTML);
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('fixture server has no port');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((err) => {
        if (err !== undefined) rejectClose(err);
        else resolveClose();
      });
    });
    await closeBrowser();
  });

  it('drops chrome from the markdown/paragraphs an agent pays for', async () => {
    const { structure } = await captureStructured({ url: `${base}/article`, options: { includeHtml: false } });

    expect(structure.content?.source).toBe('article');
    expect(structure.content?.truncated).toBe(false);

    // Real content is present...
    expect(structure.markdown).toContain('Widgets are small reusable parts.');
    expect(structure.markdown).toContain('# Widgets explained');
    expect(structure.markdown).toContain('They stay small.');
    // ...and the boilerplate is not.
    expect(structure.markdown).not.toContain('Accept all cookies');
    expect(structure.markdown).not.toContain('Copyright 2026 Example Corp.');
    expect(structure.markdown).not.toContain('Related links you probably do not need.');
    expect(structure.markdown).not.toContain('Pricing');
    expect(structure.paragraphs.join(' ')).not.toContain('cookies');

    // Images inside the content area still come through for vision steps.
    expect(structure.markdown).toContain('![widget diagram]');

    // wordCount stays the whole-page (human) count; content.words is what was kept.
    expect(structure.wordCount).toBeGreaterThan(structure.content?.words ?? 0);
  });

  it('honours a word budget: cuts at a block boundary and says so', async () => {
    const full = await captureStructured({ url: `${base}/article`, options: { includeHtml: false } });
    const capped = await captureStructured({ url: `${base}/article`, options: { includeHtml: false, maxContentWords: 25 } });

    expect(capped.structure.content?.truncated).toBe(true);
    expect(capped.structure.content?.words).toBeLessThanOrEqual(25);
    expect(capped.structure.content?.words).toBeLessThan(full.structure.content?.words ?? 0);
    expect(capped.structure.markdown.length).toBeLessThan(full.structure.markdown.length);
    // The first block survives — the budget trims the tail, it does not blank the page.
    expect(capped.structure.markdown).toContain('Widgets are small reusable parts.');
    expect(capped.structure.markdown).not.toContain('Second content paragraph');
  });

  it('falls back to the whole body when a page has no content container', async () => {
    const { structure } = await captureStructured({ url: `${base}/bare`, options: { includeHtml: false } });
    expect(structure.content?.source).toBe('body');
    expect(structure.markdown).toContain('Just one paragraph of text with no containers at all.');
    expect(structure.content?.truncated).toBe(false);
  });

  it('budget does not leak into the unbudgeted call (no shared state)', async () => {
    const capped = await captureStructured({ url: `${base}/article`, options: { includeHtml: false, maxContentWords: 25 } });
    expect(capped.structure.content?.truncated).toBe(true);
    const after = await captureStructured({ url: `${base}/article`, options: { includeHtml: false } });
    expect(after.structure.content?.truncated).toBe(false);
    expect(after.structure.markdown).toContain('Second content paragraph');
  });
});
