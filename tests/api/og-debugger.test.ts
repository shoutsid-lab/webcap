import { describe, expect, it } from 'vitest';
import { CaptureError } from '../../src/capture/errors.js';
import type { OgResult } from '../../src/capture/og.js';
import { closeApiFixture, makeApiFixture } from './fixture.js';

describe('GET /og-debugger (free OG meta debugger tool page)', () => {
  it('returns 200 text/html with a shareable GET form and no payment headers when no url is given', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
      const html = res.payload;
      expect(html).toContain('<form');
      expect(html).toContain('action="/og-debugger"');
      expect(html).toContain('name="url"');
      expect(html).toContain('Open Graph');
      // Free surface: the x402 payment challenge must never appear here.
      expect(res.headers['payment-required']).toBeUndefined();
      expect(res.headers['payment-signature']).toBeUndefined();
      expect(html).not.toContain('PAYMENT-REQUIRED');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('renders the escaped title, preview card and tag table for a valid url', async () => {
    const fx = makeApiFixture({
      og: async (req: { url: string }) => ({
        url: req.url,
        title: 'Example Title',
        description: 'An example description',
        image: 'https://example.com/og.png',
      }),
    });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
      const html = res.payload;
      expect(html).toContain('Example Title');
      expect(html).toContain('An example description');
      expect(html).toContain('<img src="https://example.com/og.png"');
      expect(html).toContain('og:title');
      expect(html).toContain('og:description');
      expect(html).toContain('og:image');
      // Funnel: the free tool points at the paid API.
      expect(html).toContain('POST /v1/x402/capture');
      expect(html).toContain('POST /v1/x402/extract');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('renders twitter and article rows in the tag table', async () => {
    const enriched = {
      url: 'https://example.com/',
      title: 'Twitter Rich Title',
      description: 'Twitter Rich Description',
      image: '/twitter-rich.png',
      twitterCard: 'summary_large_image',
      twitterSite: '@webcap',
      twitterCreator: '@author',
      twitterTitle: 'Twitter Rich Title',
      twitterDescription: 'Twitter Rich Description',
      twitterImage: '/twitter-rich.png',
      articlePublishedTime: '2026-01-02T03:04:05Z',
      articleAuthor: 'Jane Author',
      articleSection: 'Technology',
      articleTags: ['web', 'og'],
    } as OgResult;
    const fx = makeApiFixture({
      og: async (req: { url: string }) => ({ ...enriched, url: req.url }),
    });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      const html = res.payload;
      expect(html).toContain('twitter:card');
      expect(html).toContain('summary_large_image');
      expect(html).toContain('twitter:site');
      expect(html).toContain('twitter:creator');
      expect(html).toContain('twitter:title');
      expect(html).toContain('twitter:description');
      expect(html).toContain('twitter:image');
      expect(html).toContain('article:published_time');
      expect(html).toContain('article:author');
      expect(html).toContain('article:section');
      expect(html).toContain('article:tag');
      expect(html).toContain('Jane Author');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('escapes target-site values (XSS boundary: reflected HTML must be inert)', async () => {
    const fx = makeApiFixture({
      og: async (req: { url: string }) => ({
        url: req.url,
        title: '<script>alert("xss")</script>',
        description: '"><img src=x onerror=alert(1)>',
        image: 'https://example.com/og.png',
      }),
    });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      const html = res.payload;
      expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).not.toContain('<img src=x onerror=alert(1)>');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('never renders non-http(s) image URLs as <img src> (protocol gate)', async () => {
    const fx = makeApiFixture({
      og: async (req: { url: string }) => ({
        url: req.url,
        title: 'Example Title',
        image: 'javascript:alert(1)',
      }),
    });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      const html = res.payload;
      expect(html).not.toContain('<img src="javascript:');
      expect(html).toContain('Example Title');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('renders an inline error with 200 (never 500) for an invalid url', async () => {
    const fx = makeApiFixture();
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=not+a+url' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
      expect(res.payload).toContain('invalid url');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('renders an inline error with 200 (never 500) when the target is unreachable', async () => {
    const fx = makeApiFixture({
      og: async () => {
        throw new CaptureError('og fetch failed for https://example.com/: connection refused');
      },
    });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toBe('text/html; charset=utf-8');
      expect(res.payload).toContain('could not fetch');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('renders a score band with the preview score for a valid url', async () => {
    const fx = makeApiFixture({
      og: async (req: { url: string }) => ({
        url: req.url,
        title: 'Example Title',
        description: 'An example description',
        image: 'https://example.com/og.png',
      }),
    });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      const html = res.payload;
      expect(html).toContain('Preview score');
      expect(html).toMatch(/\/100/);
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('renders chat-app hints (WhatsApp, Discord, Slack) for a valid url', async () => {
    const fx = makeApiFixture({
      og: async (req: { url: string }) => ({
        url: req.url,
        title: 'Example Title',
        description: 'An example description',
        image: 'https://example.com/og.png',
      }),
    });
    try {
      const res = await fx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      const html = res.payload;
      expect(html).toContain('WhatsApp');
      expect(html).toContain('Discord');
      expect(html).toContain('Slack');
    } finally {
      await closeApiFixture(fx);
    }
  });

  it('gates the paid CTA by score: low score pushes audit/extract, high score stays soft', async () => {
    const lowFx = makeApiFixture({
      og: async (req: { url: string }) => ({ url: req.url }),
    });
    try {
      const res = await lowFx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      expect(res.payload).toContain('Fix this preview');
    } finally {
      await closeApiFixture(lowFx);
    }
    const highFx = makeApiFixture({
      og: async (req: { url: string }) => ({
        url: req.url,
        title: 'A tidy title well under sixty chars',
        description: 'A tidy description well under one hundred and sixty characters for link previews.',
        image: 'https://example.com/og.png',
        twitterCard: 'summary_large_image',
        twitterSite: '@webcap',
        twitterCreator: '@author',
        twitterTitle: 'A tidy title',
        twitterDescription: 'A tidy description',
        twitterImage: 'https://example.com/og.png',
        icon: 'https://example.com/icon.png',
      }),
    });
    try {
      const res = await highFx.app.inject({ method: 'GET', url: '/og-debugger?url=https://example.com/' });
      expect(res.statusCode).toBe(200);
      expect(res.payload).not.toContain('Fix this preview');
      expect(res.payload).toContain('Need this at scale?');
    } finally {
      await closeApiFixture(highFx);
    }
  });
});
