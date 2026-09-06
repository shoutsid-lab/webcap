import { describe, expect, it } from 'vitest';
import type { PageStructure } from '../../src/capture/pipeline.js';
import { computeAudit } from '../../src/audit/checks.js';

const PAGE_URL = 'https://example.com/page';

function structure(overrides: Partial<PageStructure> = {}): PageStructure {
  return {
    title: 'Example Title',
    description: 'A short example description.',
    headings: [{ level: 1, text: 'Hello' }],
    paragraphs: ['Some body text.'],
    links: [{ href: 'https://example.com/about', text: 'about' }],
    images: [],
    wordCount: 3,
    markdown: '# Hello\n\nSome body text.',
    ...overrides,
  };
}

const FULL_HTML = [
  '<html><head>',
  '<title>Example Title</title>',
  '<meta name="description" content="A short example description.">',
  '<meta property="og:title" content="OG Title">',
  '<meta property="og:description" content="OG Desc">',
  '<meta property="og:image" content="https://example.com/og.png">',
  '<link rel="canonical" href="https://example.com/page">',
  '<meta name="robots" content="index, follow">',
  '</head><body><h1>Hello</h1><a href="https://example.com/about">about</a></body></html>',
].join('');

describe('computeAudit', () => {
  it('reports title present with lengths', () => {
    const audit = computeAudit({ structure: structure(), html: FULL_HTML, pageUrl: PAGE_URL });
    expect(audit.seo.title.present).toBe(true);
    expect(audit.seo.title.length).toBe('Example Title'.length);
    expect(audit.seo.description.present).toBe(true);
    expect(audit.seo.description.length).toBe('A short example description.'.length);
  });

  it('reports missing title and description as absent', () => {
    const audit = computeAudit({
      structure: structure({ title: '', description: '' }),
      html: '<html><head></head><body></body></html>',
      pageUrl: PAGE_URL,
    });
    expect(audit.seo.title.present).toBe(false);
    expect(audit.seo.title.length).toBe(0);
    expect(audit.seo.description.present).toBe(false);
    expect(audit.seo.description.length).toBe(0);
  });

  it('counts h1 headings', () => {
    const audit = computeAudit({
      structure: structure({ headings: [{ level: 1, text: 'A' }, { level: 2, text: 'B' }, { level: 1, text: 'C' }] }),
      html: FULL_HTML,
      pageUrl: PAGE_URL,
    });
    expect(audit.seo.h1Count).toBe(2);
  });

  it('reports OG title/description/image presence', () => {
    const audit = computeAudit({ structure: structure(), html: FULL_HTML, pageUrl: PAGE_URL });
    expect(audit.og.present.title).toBe(true);
    expect(audit.og.present.description).toBe(true);
    expect(audit.og.present.image).toBe(true);
    const missing = computeAudit({
      structure: structure(),
      html: '<html><head><title>t</title></head><body></body></html>',
      pageUrl: PAGE_URL,
    });
    expect(missing.og.present.title).toBe(false);
    expect(missing.og.present.description).toBe(false);
    expect(missing.og.present.image).toBe(false);
  });

  it('parses canonical and robots meta', () => {
    const audit = computeAudit({ structure: structure(), html: FULL_HTML, pageUrl: PAGE_URL });
    expect(audit.seo.canonical).toEqual({ present: true, value: 'https://example.com/page' });
    expect(audit.seo.robotsMeta).toEqual({ present: true, value: 'index, follow' });
    const missing = computeAudit({
      structure: structure(),
      html: '<html><head></head><body></body></html>',
      pageUrl: PAGE_URL,
    });
    expect(missing.seo.canonical).toEqual({ present: false, value: undefined });
  });

  it('counts links: total/internal/external/emptyText/duplicates', () => {
    const audit = computeAudit({
      structure: structure({
        links: [
          { href: 'https://example.com/a', text: 'a' },
          { href: 'https://example.com/a', text: 'a again' },
          { href: 'https://external.com/x', text: '' },
        ],
      }),
      html: FULL_HTML,
      pageUrl: PAGE_URL,
    });
    expect(audit.links.total).toBe(3);
    expect(audit.links.internal).toBe(2);
    expect(audit.links.external).toBe(1);
    expect(audit.links.emptyText).toBe(1);
    expect(audit.links.duplicates).toBe(1);
  });
});
