import { describe, expect, it } from 'vitest';
import type { OgResult } from '../../src/capture/og.js';
import { computeOgScore } from '../../src/capture/og-score.js';

const FULL: OgResult = {
  url: 'https://example.com/',
  title: 'A tidy title well under sixty chars',
  description: 'A tidy description well under one hundred and sixty characters for link previews.',
  image: 'https://example.com/og.png',
  icon: 'https://example.com/icon.png',
  twitterCard: 'summary_large_image',
  twitterSite: '@webcap',
  twitterCreator: '@author',
  twitterTitle: 'A tidy title',
  twitterDescription: 'A tidy description',
  twitterImage: 'https://example.com/og.png',
  articlePublishedTime: '2026-01-02T03:04:05Z',
  articleAuthor: 'Jane Author',
  articleSection: 'Technology',
  articleTags: ['web', 'og'],
};

const EMPTY: OgResult = { url: 'https://example.com/' };

describe('computeOgScore (pure OG preview scorer)', () => {
  it('bounds the score to 0-100 for empty and full results', () => {
    for (const input of [EMPTY, FULL]) {
      const { score } = computeOgScore(input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('scores a full result higher than an empty one', () => {
    expect(computeOgScore(FULL).score).toBeGreaterThan(computeOgScore(EMPTY).score);
  });

  it('is deterministic: same input gives same output', () => {
    const first = computeOgScore(FULL);
    const second = computeOgScore(FULL);
    expect(second).toEqual(first);
  });

  it('references missing tags in issues for an empty result', () => {
    const { issues } = computeOgScore(EMPTY);
    const joined = issues.join('\n');
    expect(joined).toContain('og:title');
    expect(joined).toContain('og:description');
    expect(joined).toContain('og:image');
  });

  it('derives suggestedTags from what is missing', () => {
    const { suggestedTags } = computeOgScore(EMPTY);
    expect(suggestedTags).toContain('og:title');
    expect(suggestedTags).toContain('og:description');
    expect(suggestedTags).toContain('og:image');
    expect(suggestedTags).toContain('twitter:card');
    expect(computeOgScore(FULL).suggestedTags).toEqual([]);
  });
});
