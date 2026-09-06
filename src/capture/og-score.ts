/**
 * Pure OG preview scorer for the free /og-debugger tool page.
 *
 * Deterministic: same OgResult in -> same score/issues/suggestedTags out
 * (no I/O, no clock, no randomness). Render-only: the debugger page calls
 * this to display a score band, chat-app hints and a score-gated CTA; the
 * capture pipeline is untouched and no live image-dimension probing happens.
 *
 * Rubric (max 99, clamped to 0-100):
 * - og:title present: +30 (over 60 chars: +20 instead — truncation penalty)
 * - og:description present: +25 (over ~160 chars: +20 instead — truncation penalty)
 * - og:image present: +20
 * - twitter:card present: +10
 * - icon present (favicon bonus): +5
 * - twitter extras (site/creator/title/description/image): +1 each, max +5
 * - article extras (published_time/author/section/tags): +1 each, max +4
 * Missing core tags also surface as issues + suggestedTags entries.
 */
import type { OgResult } from './og.js';

export interface OgScore {
  readonly score: number;
  readonly issues: readonly string[];
  readonly suggestedTags: readonly string[];
}

/** Score below which the debugger pushes the paid audit/extract CTA hard. */
export const OG_SCORE_LOW_THRESHOLD = 50;

const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

export function computeOgScore(result: OgResult): OgScore {
  let score = 0;
  const issues: string[] = [];
  const suggestedTags: string[] = [];

  if (result.title === undefined) {
    issues.push('Missing og:title — chat apps fall back to the bare URL.');
    suggestedTags.push('og:title');
  } else if (result.title.length > TITLE_MAX) {
    score += 20;
    issues.push(`og:title is ${result.title.length} chars (aim <=${TITLE_MAX}) — long titles get truncated.`);
  } else {
    score += 30;
  }

  if (result.description === undefined) {
    issues.push('Missing og:description — previews render with no summary text.');
    suggestedTags.push('og:description');
  } else if (result.description.length > DESCRIPTION_MAX) {
    score += 20;
    issues.push(`og:description is ${result.description.length} chars (aim <=~${DESCRIPTION_MAX}) — long descriptions get cut off.`);
  } else {
    score += 25;
  }

  if (result.image === undefined) {
    issues.push('Missing og:image — link previews render as text-only.');
    suggestedTags.push('og:image');
  } else {
    score += 20;
  }

  if (result.twitterCard === undefined) {
    issues.push('Missing twitter:card — X falls back to a small summary card.');
    suggestedTags.push('twitter:card');
  } else {
    score += 10;
  }

  if (result.icon !== undefined) score += 5;

  const twitterExtras = [
    result.twitterSite,
    result.twitterCreator,
    result.twitterTitle,
    result.twitterDescription,
    result.twitterImage,
  ];
  score += Math.min(5, twitterExtras.filter((value) => value !== undefined).length);

  const articleExtras = [
    result.articlePublishedTime,
    result.articleAuthor,
    result.articleSection,
    result.articleTags === undefined || result.articleTags.length === 0 ? undefined : result.articleTags.join(','),
  ];
  score += Math.min(4, articleExtras.filter((value) => value !== undefined).length);

  return {
    score: Math.min(100, Math.max(0, score)),
    issues,
    suggestedTags,
  };
}
