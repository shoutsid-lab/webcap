import { describe, expect, it } from 'vitest';
import {
  MAP_LITE_DEFAULT_MAX_URLS,
  MAP_LITE_MAX_URLS,
  extractRobotsSitemapUrls,
  extractSameHostLinks,
  extractSitemapLocs,
  filterMapLiteCandidates,
  parseMapLiteRequest,
} from '../../src/server/map-lite.js';
import { HttpError } from '../../src/util/errors.js';

function expectUnprocessable(body: unknown, fragment: string): void {
  try {
    parseMapLiteRequest(body, undefined);
    expect.unreachable('expected parseMapLiteRequest to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    if (err instanceof HttpError) {
      expect(err.status).toBe(422);
      expect(err.message).toContain(fragment);
    }
  }
}

describe('server/map-lite parseMapLiteRequest', () => {
  it('defaults maxUrls to 20 and normalizes the seed url', () => {
    expect(parseMapLiteRequest({ url: 'https://example.com/' }, undefined)).toEqual({
      url: 'https://example.com/',
      maxUrls: MAP_LITE_DEFAULT_MAX_URLS,
    });
    expect(MAP_LITE_DEFAULT_MAX_URLS).toBe(20);
  });

  it('caps maxUrls at 50', () => {
    expect(MAP_LITE_MAX_URLS).toBe(50);
    expect(parseMapLiteRequest({ url: 'https://example.com/', maxUrls: 50 }, undefined).maxUrls).toBe(50);
    expect(parseMapLiteRequest({ url: 'https://example.com/', maxUrls: 1 }, undefined).maxUrls).toBe(1);
  });

  it('rejects maxUrls above 50 with 422', () => {
    expectUnprocessable({ url: 'https://example.com/', maxUrls: 51 }, 'maxUrls must be');
  });

  it.each([[0], [-1], [1.5], ['20'], [true], [null]])('rejects maxUrls %o with 422', (maxUrls) => {
    expectUnprocessable({ url: 'https://example.com/', maxUrls }, 'maxUrls must be');
  });

  it('rejects a missing or invalid url with 422', () => {
    expectUnprocessable({}, 'url is required');
    expectUnprocessable({ url: 42 }, 'url is required');
    expectUnprocessable({ url: 'not-a-url' }, 'invalid url');
    expectUnprocessable({ url: 'ftp://example.com/' }, 'invalid url');
  });

  it('rejects a non-object body with 422', () => {
    expectUnprocessable(null, 'body must be an object');
    expectUnprocessable('https://example.com/', 'body must be an object');
  });
});

describe('server/map-lite extractSitemapLocs', () => {
  it('parses urlset <loc> entries', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://example.com/</loc></url>
<url><loc>https://example.com/about</loc></url>
</urlset>`;
    expect(extractSitemapLocs(xml)).toEqual(['https://example.com/', 'https://example.com/about']);
  });

  it('parses sitemapindex <loc> entries (child sitemaps)', () => {
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
</sitemapindex>`;
    expect(extractSitemapLocs(xml)).toEqual(['https://example.com/sitemap-posts.xml']);
  });

  it('returns an empty list for malformed or loc-free xml', () => {
    expect(extractSitemapLocs('not xml at all')).toEqual([]);
    expect(extractSitemapLocs('<urlset></urlset>')).toEqual([]);
  });
});

describe('server/map-lite extractRobotsSitemapUrls', () => {
  it('collects Sitemap: lines case-insensitively', () => {
    const robots = 'User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\nsitemap: https://example.com/other.xml\n';
    expect(extractRobotsSitemapUrls(robots)).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/other.xml',
    ]);
  });

  it('ignores comments and non-sitemap lines', () => {
    const robots = '# Sitemap: https://example.com/nope.xml\nUser-agent: *\nDisallow: /private\n';
    expect(extractRobotsSitemapUrls(robots)).toEqual([]);
  });
});

describe('server/map-lite extractSameHostLinks', () => {
  const html = `<html><body>
<a href="/about">About</a>
<a href="https://example.com/contact">Contact</a>
<a href='https://example.com/contact'>Contact again</a>
<a href="https://other.com/evil">External</a>
<a href="https://sub.example.com/x">Subdomain</a>
<a href="javascript:void(0)">JS</a>
<a href="mailto:a@example.com">Mail</a>
<a href="#fragment">Fragment</a>
</body></html>`;

  it('keeps same-host absolute + relative links, drops cross-host and non-http(s)', () => {
    expect(extractSameHostLinks(html, 'https://example.com/')).toEqual([
      'https://example.com/about',
      'https://example.com/contact',
    ]);
  });

  it('resolves relative links against the seed page url', () => {
    expect(extractSameHostLinks('<a href="docs/intro">x</a>', 'https://example.com/guide/')).toEqual([
      'https://example.com/guide/docs/intro',
    ]);
  });
});

describe('server/map-lite filterMapLiteCandidates', () => {
  it('dedupes, enforces the single-domain filter, and caps at maxUrls', () => {
    const candidates = [
      'https://example.com/a',
      'https://example.com/a',
      'https://example.com/b',
      'https://other.com/c',
      'https://example.com/c',
    ];
    expect(filterMapLiteCandidates(candidates, 'https://example.com/', 2, undefined)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('drops candidates that fail validateCaptureUrl instead of failing the batch', () => {
    const candidates = ['https://example.com/ok', 'http://127.0.0.1/private', 'javascript:void(0)'];
    expect(filterMapLiteCandidates(candidates, 'https://example.com/', 50, undefined)).toEqual([
      'https://example.com/ok',
    ]);
  });
});
