import { describe, expect, it } from 'vitest';
import type { PageStructure } from '../../src/capture/pipeline.js';
import { computeAudit, type AuditOg } from '../../src/audit/checks.js';

type EnrichedAuditOg = AuditOg & {
  readonly twitterCard?: string;
  readonly twitterSite?: string;
  readonly twitterCreator?: string;
  readonly twitterTitle?: string;
  readonly twitterDescription?: string;
  readonly twitterImage?: string;
  readonly articlePublishedTime?: string;
  readonly articleAuthor?: string;
  readonly articleSection?: string;
  readonly articleTags?: readonly string[];
};

type EnrichedPresent = EnrichedAuditOg['present'] & {
  readonly twitterCard?: boolean;
  readonly twitterSite?: boolean;
  readonly twitterCreator?: boolean;
  readonly twitterTitle?: boolean;
  readonly twitterDescription?: boolean;
  readonly twitterImage?: boolean;
  readonly articlePublishedTime?: boolean;
  readonly articleAuthor?: boolean;
  readonly articleSection?: boolean;
  readonly articleTags?: boolean;
};

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
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:site" content="@webcap">',
  '<meta name="twitter:creator" content="@author">',
  '<meta name="twitter:title" content="Twitter Title">',
  '<meta name="twitter:description" content="Twitter Desc">',
  '<meta name="twitter:image" content="https://example.com/tw.png">',
  '<meta property="article:published_time" content="2026-01-02T03:04:05Z">',
  '<meta property="article:author" content="Jane Author">',
  '<meta property="article:section" content="Technology">',
  '<meta property="article:tag" content="web">',
  '<meta property="article:tag" content="og">',
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

  it('reports twitter/article meta presence', () => {
    const enriched: EnrichedAuditOg = computeAudit({ structure: structure(), html: FULL_HTML, pageUrl: PAGE_URL }).og;
    const present: EnrichedPresent = enriched.present;
    expect(enriched.twitterCard).toBe('summary_large_image');
    expect(enriched.twitterSite).toBe('@webcap');
    expect(enriched.twitterCreator).toBe('@author');
    expect(enriched.twitterTitle).toBe('Twitter Title');
    expect(enriched.twitterDescription).toBe('Twitter Desc');
    expect(enriched.twitterImage).toBe('https://example.com/tw.png');
    expect(enriched.articlePublishedTime).toBe('2026-01-02T03:04:05Z');
    expect(enriched.articleAuthor).toBe('Jane Author');
    expect(enriched.articleSection).toBe('Technology');
    expect(enriched.articleTags).toEqual(['web', 'og']);
    expect(present.twitterCard).toBe(true);
    expect(present.twitterSite).toBe(true);
    expect(present.twitterCreator).toBe(true);
    expect(present.twitterTitle).toBe(true);
    expect(present.twitterDescription).toBe(true);
    expect(present.twitterImage).toBe(true);
    expect(present.articlePublishedTime).toBe(true);
    expect(present.articleAuthor).toBe(true);
    expect(present.articleSection).toBe(true);
    expect(present.articleTags).toBe(true);
    const missingPresent: EnrichedPresent = computeAudit({
      structure: structure(),
      html: '<html><head><title>t</title></head><body></body></html>',
      pageUrl: PAGE_URL,
    }).og.present;
    const missing: EnrichedAuditOg = computeAudit({
      structure: structure(),
      html: '<html><head><title>t</title></head><body></body></html>',
      pageUrl: PAGE_URL,
    }).og;
    expect(missingPresent.twitterCard).toBe(false);
    expect(missingPresent.articlePublishedTime).toBe(false);
    expect(missingPresent.articleTags).toBe(false);
    expect(missing.articleTags).toBeUndefined();
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
    expect(audit.links.sample).toEqual([
      { href: 'https://example.com/a', text: 'a' },
      { href: 'https://example.com/a', text: 'a again' },
      { href: 'https://external.com/x', text: '' },
    ]);
    for (const item of audit.links.sample) {
      expect(typeof item.href).toBe('string');
      expect(typeof item.text).toBe('string');
    }
  });
});
