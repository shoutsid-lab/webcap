import type { PageStructure } from '../capture/pipeline.js';
import { computeAudit } from '../audit/checks.js';
import { metaContent } from '../util/html-parse.js';
import type { AnalysisTask } from './vision/contracts.js';

export interface DeterministicArgs {
  readonly structure: PageStructure;
  readonly html: string;
  readonly pageUrl: string;
  readonly task: AnalysisTask;
  readonly context?: string;
}

const POSITIVE_WORDS = new Set([
  'great', 'excellent', 'amazing', 'awesome', 'best', 'love', 'perfect', 'wonderful',
  'fantastic', 'outstanding', 'superb', 'brilliant', 'innovative', 'free', 'easy',
  'fast', 'powerful', 'trusted', 'leading', 'top', 'success', 'happy', 'good',
]);

const NEGATIVE_WORDS = new Set([
  'bad', 'terrible', 'awful', 'worst', 'hate', 'broken', 'fail', 'error',
  'problem', 'issue', 'bug', 'slow', 'difficult', 'hard', 'poor', 'wrong',
  'danger', 'risk', 'warning', 'critical', 'fatal', 'crash',
]);

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
}

export interface PageClassification {
  readonly category: string;
  readonly confidence: number;
  readonly tags: readonly string[];
  readonly mode: 'deterministic';
}

export interface ClassifyPageArgs {
  readonly structure: PageStructure;
  readonly pageUrl: string;
  readonly html?: string;
}

export function classifyPage(args: ClassifyPageArgs): PageClassification {
  const { structure, pageUrl } = args;
  const html = args.html ?? '';
  const text = `${structure.title} ${structure.description} ${structure.markdown}`.toLowerCase();
  let hostname = '';
  let pathname = '';
  try {
    const parsed = new URL(pageUrl);
    hostname = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    hostname = '';
  }
  const ogType = metaContent(html, 'og:type')?.toLowerCase() ?? '';
  if (ogType === 'article') return result('article', 0.8, structure, hostname);
  if (ogType === 'product') return result('product', 0.8, structure, hostname);
  if (ogType === 'profile') return result('social-media', 0.75, structure, hostname);
  const pathRules: Array<[string, RegExp, number]> = [
    ['documentation', /\/(docs|documentation|api|reference|guide)\b/, 0.7],
    ['blog', /\/blog\b/, 0.7],
    ['forum', /\/(forum|community|topic|threads)\b/, 0.7],
    ['wiki', /\/wiki\b/, 0.75],
    ['news', /\/news\b/, 0.65],
    ['e-commerce', /\/(shop|store|products?|cart|checkout|collections?)\b/, 0.7],
    ['form', /\/(signup|sign-up|login|signin|sign-in|register)\b/, 0.7],
    ['landing-page', /\/(pricing|features)\b/, 0.6],
  ];
  for (const [category, re, confidence] of pathRules) {
    if (re.test(pathname)) return result(category, confidence, structure, hostname);
  }
  const textRules: Array<[string, RegExp, number]> = [
    ['e-commerce', /\b(cart|checkout|buy now|add to cart|price|\$\d|shop|store|product)\b/, 0.65],
    ['documentation', /\b(api|reference|docs|documentation|guide|tutorial|getting started|sdk)\b/, 0.65],
    ['news', /\b(breaking|news|reporter|headline|published|article)\b/, 0.6],
    ['blog', /\b(blog|post|author|comments|subscribe|newsletter)\b/, 0.55],
    ['forum', /\b(thread|reply|replies|forum|topic|post by|member since)\b/, 0.6],
    ['form', /\b(sign up|log in|login|register|submit|password|username)\b/, 0.55],
    ['landing-page', /\b(get started|try free|pricing|features|hero|cta|sign up)\b/, 0.55],
    ['dashboard', /\b(dashboard|analytics|metrics|overview|settings|account)\b/, 0.6],
  ];
  let bestCategory = 'other';
  let bestConfidence = 0.4;
  for (const [category, re, confidence] of textRules) {
    if (re.test(text) && confidence > bestConfidence) {
      bestCategory = category;
      bestConfidence = confidence;
    }
  }
  return result(bestCategory, bestConfidence, structure, hostname);
}

function result(category: string, confidence: number, structure: PageStructure, hostname: string): PageClassification {
  const tags = new Set<string>();
  if (/github|gitlab|npm|pypi|crates/.test(hostname)) tags.add('developer');
  if (structure.images.length > 5) tags.add('media-rich');
  if (structure.links.length > 30) tags.add('link-dense');
  if (structure.wordCount > 2000) tags.add('long-form');
  if (structure.headings.every((h) => h.level !== 1)) tags.add('no-h1');
  return { category, confidence, tags: [...tags].slice(0, 10), mode: 'deterministic' };
}

function classify(structure: PageStructure, pageUrl: string, html: string): PageClassification {
  return classifyPage({ structure, pageUrl, html });
}

function accessibility(structure: PageStructure, html: string, pageUrl: string): Record<string, unknown> {
  const audit = computeAudit({ structure, html, pageUrl, linkSampleLimit: 0 });
  const issues: Array<Record<string, unknown>> = [];
  if (!audit.seo.title.present) {
    issues.push({ severity: 'error', type: 'missing-title', message: 'Page has no <title>', wcag: 'WCAG 2.4.2' });
  }
  if (audit.seo.h1Count === 0) {
    issues.push({ severity: 'error', type: 'missing-h1', message: 'Page has no <h1> heading', wcag: 'WCAG 1.3.1' });
  } else if (audit.seo.h1Count > 1) {
    issues.push({ severity: 'warning', type: 'multiple-h1', message: `Page has ${audit.seo.h1Count} <h1> headings`, wcag: 'WCAG 1.3.1' });
  }
  if (!audit.seo.description.present) {
    issues.push({ severity: 'warning', type: 'missing-description', message: 'Page has no meta description', wcag: 'WCAG 2.4.6' });
  }
  const missingAlt = structure.images.filter((img) => img.alt.trim() === '').length;
  if (missingAlt > 0) {
    issues.push({ severity: 'error', type: 'missing-alt', message: `${missingAlt} image(s) missing alt text`, wcag: 'WCAG 1.1.1' });
  }
  if (audit.links.emptyText > 0) {
    issues.push({ severity: 'warning', type: 'empty-link-text', message: `${audit.links.emptyText} link(s) with empty text`, wcag: 'WCAG 2.4.4' });
  }
  let lastLevel = 0;
  for (const h of structure.headings) {
    if (lastLevel > 0 && h.level > lastLevel + 1) {
      issues.push({ severity: 'info', type: 'heading-skip', message: `Heading level jumps from h${lastLevel} to h${h.level}: "${h.text.slice(0, 60)}"`, wcag: 'WCAG 1.3.1' });
      break;
    }
    lastLevel = h.level;
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const score = Math.max(0, 100 - errors * 20 - warnings * 5);
  return {
    score,
    issues: issues.slice(0, 50),
    summary: `${issues.length} issue(s) found (${errors} error, ${warnings} warning); score ${score}/100 (deterministic DOM check, not a full audit)`,
    mode: 'deterministic',
  };
}

function layout(structure: PageStructure): Record<string, unknown> {
  const maxDepth = structure.headings.reduce((m, h) => Math.max(m, h.level), 0);
  const hierarchy = maxDepth <= 1 ? 'shallow' : maxDepth === 2 ? 'medium' : 'deep';
  const avgParaLen = structure.paragraphs.length === 0
    ? 0
    : structure.paragraphs.reduce((s, p) => s + p.length, 0) / structure.paragraphs.length;
  const readabilityScore = Math.max(0, Math.min(100, Math.round(100 - Math.max(0, avgParaLen - 200) / 10 - (structure.links.length > 100 ? 10 : 0))));
  return {
    elements: [
      { type: 'title', text: structure.title, importance: 'high' },
      ...structure.headings.slice(0, 20).map((h) => ({ type: `h${h.level}`, text: h.text, importance: h.level <= 2 ? 'high' : 'medium' })),
    ],
    hierarchy,
    readabilityScore,
    summary: `${structure.headings.length} headings (depth h${maxDepth || '—'}), ${structure.paragraphs.length} paragraphs, ${structure.links.length} links, ${structure.images.length} images; ${hierarchy} hierarchy (deterministic)`,
    mode: 'deterministic',
  };
}

function entities(structure: PageStructure): Record<string, unknown> {
  const text = `${structure.title}\n${structure.description}\n${structure.markdown}\n${structure.paragraphs.join('\n')}`;
  const found: Array<{ type: string; value: string; confidence: number }> = [];
  const push = (type: string, value: string, confidence: number): void => {
    const v = value.trim().slice(0, 200);
    if (v !== '' && !found.some((e) => e.type === type && e.value === v)) found.push({ type, value: v, confidence });
  };
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const urlRe = /https?:\/\/[^\s"'<>]+/g;
  const priceRe = /\$\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*\s?(?:USD|USDC|ETH)/g;
  const phoneRe = /\+?\d[\d\s().-]{7,}\d/g;
  const dateRe = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{4})\b/gi;
  for (const m of text.matchAll(emailRe)) push('email', m[0], 0.9);
  for (const m of text.matchAll(priceRe)) push('price', m[0], 0.8);
  for (const m of text.matchAll(dateRe)) push('date', m[0], 0.8);
  for (const m of text.matchAll(phoneRe)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 7) push('phone', m[0], 0.6);
  }
  for (const m of text.matchAll(urlRe)) push('url', m[0], 0.95);
  for (const l of structure.links.slice(0, 50)) push('url', l.href, 0.95);
  return {
    entities: found.slice(0, 100),
    summary: `${found.length} entit(ies) detected by deterministic patterns (email/price/date/phone/url)`,
    mode: 'deterministic',
  };
}

function sentiment(structure: PageStructure): Record<string, unknown> {
  const words = tokens(`${structure.title} ${structure.description} ${structure.markdown}`);
  let pos = 0;
  let neg = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) pos += 1;
    if (NEGATIVE_WORDS.has(w)) neg += 1;
  }
  const total = pos + neg;
  const sentimentLabel = total === 0 ? 'neutral' : pos > neg * 2 ? 'positive' : neg > pos * 2 ? 'negative' : pos === neg ? 'mixed' : pos > neg ? 'positive' : 'negative';
  const confidence = total === 0 ? 0.5 : Math.min(0.95, 0.55 + Math.abs(pos - neg) / Math.max(1, total) * 0.4);
  const text = structure.markdown.toLowerCase();
  const tone = /\b(api|sdk|function|parameter|endpoint|protocol)\b/.test(text)
    ? 'technical'
    : /\b(i|we|you|our|let's)\b/.test(text) ? 'conversational' : /\b(please|kindly|dear|sincerely)\b/.test(text) ? 'formal' : 'informal';
  return {
    sentiment: sentimentLabel,
    confidence: Math.round(confidence * 100) / 100,
    tone,
    readabilityGrade: structure.wordCount > 1500 ? 'long-form' : structure.wordCount > 400 ? 'standard' : 'brief',
    summary: `${pos} positive / ${neg} negative cue words over ${words.length} tokens (deterministic word-list analysis)`,
    mode: 'deterministic',
  };
}

export function deterministicAnalyze(args: DeterministicArgs): unknown {
  switch (args.task) {
    case 'classification':
      return classify(args.structure, args.pageUrl, args.html);
    case 'accessibility':
      return accessibility(args.structure, args.html, args.pageUrl);
    case 'layout':
      return layout(args.structure);
    case 'entities':
      return entities(args.structure);
    case 'sentiment':
      return sentiment(args.structure);
    case 'diff':
      return { changed: false, changeType: 'none', similarity: 1, description: 'diff requires two captures; deterministic single-page mode has no baseline', mode: 'deterministic' };
  }
}
