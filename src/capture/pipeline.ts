import type { Page } from 'playwright-core';
import { newContext, resolveProxyServer, type ContextCookie, type ContextViewportOptions } from './browser.js';
import { CaptureError } from './errors.js';
import { DEFAULT_CAPTURE_TIMEOUT_CAP_MS, DEFAULT_CAPTURE_TIMEOUT_MS } from '../config.js';

export type CaptureFormat = 'png' | 'jpeg' | 'pdf';

export type CaptureProxy = 'auto' | 'stealth' | string;

export interface CaptureWaitFor {
  readonly selector: string;
  readonly timeoutMs?: number;
}

export type CaptureAction =
  | { readonly type: 'click'; readonly selector: string }
  | { readonly type: 'type'; readonly selector: string; readonly text: string }
  | { readonly type: 'wait'; readonly timeoutMs: number }
  | { readonly type: 'goto'; readonly url: string };

export interface CaptureOptions {
  readonly timeoutMs?: number;
  readonly fullPage?: boolean;
  readonly includeHtml?: boolean;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly userAgent?: string;
  readonly deviceScaleFactor?: number;
  readonly isMobile?: boolean;
  readonly proxy?: CaptureProxy;
  /** Hardened anti-bot context (realistic UA/viewport defaults + webdriver mask); proxy 'stealth' also enables this. */
  readonly stealth?: boolean;
  readonly waitFor?: CaptureWaitFor;
  readonly actions?: readonly CaptureAction[];
  /**
   * Word budget for the extracted main content (`paragraphs` + `markdown`).
   * Lets an agent size a page to its context window instead of paying for a
   * whole document; content is cut at a block boundary and `content.truncated`
   * reports it. Clamped to [MIN_CONTENT_WORDS, MAX_CONTENT_WORDS].
   */
  readonly maxContentWords?: number;
  /** Context auth headers (per-watch stored auth or the ad-hoc `options.auth` field). */
  readonly extraHTTPHeaders?: Record<string, string>;
  /** Context auth cookies applied via addCookies (per-watch stored auth or `options.auth`). */
  readonly cookies?: readonly ContextCookie[];
}

export interface CaptureRequest {
  readonly url: string;
  readonly format?: CaptureFormat;
  readonly options?: CaptureOptions;
}

export interface CaptureResult {
  readonly buffer: Buffer;
  readonly format: CaptureFormat;
  readonly bytes: number;
}

export interface PageStructure {
  readonly title: string;
  readonly description: string;
  readonly headings: readonly { readonly level: number; readonly text: string }[];
  readonly paragraphs: readonly string[];
  readonly links: readonly { readonly href: string; readonly text: string }[];
  readonly images: readonly { readonly src: string; readonly alt: string }[];
  /** Words on the whole page (chrome included) — what a human sees. */
  readonly wordCount: number;
  readonly markdown: string;
  /**
   * What the machine-readable fields (`paragraphs`/`markdown`) actually contain:
   * which container was chosen and how much of it was kept. Absent only from
   * callers that build a structure by hand (tests, fallbacks).
   */
  readonly content?: PageContentInfo;
}

/** Provenance of the extracted main content, so a caller can trust and size it. */
export interface PageContentInfo {
  /** Selector the content was taken from ('body' = whole page fallback). */
  readonly source: string;
  /** Words included in `paragraphs`/`markdown` after chrome removal and budget. */
  readonly words: number;
  /** True when `maxContentWords` cut the content short. */
  readonly truncated: boolean;
}

/** Bounds for the agent-facing content budget (`maxContentWords`). */
export const MIN_CONTENT_WORDS = 25;
export const MAX_CONTENT_WORDS = 100_000;

/** The rendered HTML + its extracted structure (html feeds model-based extraction). */
export interface StructuredCapture {
  readonly html: string;
  readonly structure: PageStructure;
}

/** Page-load timeout tuning; a client-specified timeoutMs is capped at capMs. */
export interface CaptureTimeouts {
  readonly defaultMs?: number;
  readonly capMs?: number;
}

function contextViewport(req: CaptureRequest): ContextViewportOptions {
  const o = req.options;
  if (o === undefined) return {};
  return {
    ...(o.viewport !== undefined ? { viewport: o.viewport } : {}),
    ...(o.userAgent !== undefined ? { userAgent: o.userAgent } : {}),
    ...(o.deviceScaleFactor !== undefined ? { deviceScaleFactor: o.deviceScaleFactor } : {}),
    ...(o.isMobile !== undefined ? { isMobile: o.isMobile } : {}),
    ...(o.proxy !== undefined
      ? { proxyServer: resolveProxyServer(o.proxy), ...(o.proxy === 'stealth' || o.stealth === true ? { stealth: true as const } : {}) }
      : o.stealth === true
        ? { stealth: true as const }
        : {}),
    ...(o.extraHTTPHeaders !== undefined ? { extraHTTPHeaders: o.extraHTTPHeaders } : {}),
    ...(o.cookies !== undefined ? { cookies: cookiesForUrl(o.cookies, req.url) } : {}),
  };
}

/**
 * Scope domain-less cookies to the capture URL: Playwright's addCookies
 * rejects a cookie with neither url nor a domain/path pair, and a caller
 * capturing one URL almost always means "this site". Domain cookies pass
 * through untouched.
 */
export function cookiesForUrl(cookies: readonly ContextCookie[], url: string): ContextCookie[] {
  return cookies.map((cookie) =>
    cookie.domain !== undefined || cookie.url !== undefined ? { ...cookie } : { ...cookie, url },
  );
}

function resolveTimeout(req: CaptureRequest, timeouts?: CaptureTimeouts): number {
  const requested = req.options?.timeoutMs ?? timeouts?.defaultMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  return Math.min(requested, timeouts?.capMs ?? DEFAULT_CAPTURE_TIMEOUT_CAP_MS);
}

/**
 * Post-load, pre-shot page settling: an optional selector wait followed by a
 * bounded client-action loop (click/type/wait, at most MAX_STEALTH_ACTIONS).
 * Parse-time validation guarantees the bound; the slice is defense in depth.
 */
export const MAX_STEALTH_ACTIONS = 5;

async function settlePage(page: Page, req: CaptureRequest, timeouts?: CaptureTimeouts): Promise<void> {
  const waitFor = req.options?.waitFor;
  if (waitFor !== undefined) {
    await page.waitForSelector(waitFor.selector, { timeout: waitFor.timeoutMs });
  }
  const actions = req.options?.actions ?? [];
  for (const action of actions.slice(0, MAX_STEALTH_ACTIONS)) {
    switch (action.type) {
      case 'click':
        await page.click(action.selector);
        break;
      case 'type':
        await page.fill(action.selector, action.text);
        break;
      case 'wait':
        await page.waitForTimeout(action.timeoutMs);
        break;
      case 'goto':
        await page.goto(action.url, { timeout: resolveTimeout(req, timeouts), waitUntil: 'load' });
        break;
      default: {
        const exhaustive: never = action;
        throw new Error(`unknown capture action: ${String(exhaustive)}`);
      }
    }
  }
}

export async function capture(req: CaptureRequest, timeouts?: CaptureTimeouts): Promise<CaptureResult> {
  const format: CaptureFormat = req.format ?? 'png';
  try {
    const context = await newContext(contextViewport(req));
    try {
      const page = await context.newPage();
      try {
        await page.goto(req.url, { timeout: resolveTimeout(req, timeouts), waitUntil: 'load' });
        await settlePage(page, req, timeouts);
        const buffer =
          format === 'pdf' ? await page.pdf({}) : await page.screenshot({ fullPage: req.options?.fullPage, type: format });
        return { buffer, format, bytes: buffer.length };
      } finally {
        await page.close();
      }
    } finally {
      await context.close();
    }
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw new CaptureError(`capture failed for ${req.url}: ${errorMessage(err)}`, { cause: err });
  }
}

/** Capture a URL and extract its rendered DOM structure + HTML (for the structured-output endpoint). */
export async function captureStructured(req: CaptureRequest, timeouts?: CaptureTimeouts): Promise<StructuredCapture> {
  try {
    const context = await newContext(contextViewport(req));
    try {
      const page = await context.newPage();
      try {
        await page.goto(req.url, { timeout: resolveTimeout(req, timeouts), waitUntil: 'load' });
        await settlePage(page, req, timeouts);
        const structure = await page.evaluate(extractStructureFromDom, req.options?.maxContentWords ?? null);
        const html = req.options?.includeHtml === false ? '' : await page.content();
        return { html, structure };
      } finally {
        await page.close();
      }
    } finally {
      await context.close();
    }
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw new CaptureError(`structured capture failed for ${req.url}: ${errorMessage(err)}`, { cause: err });
  }
}

/**
 * Runs in the page context (browser) via page.evaluate, so it must be self-contained
 * (no Node imports or outer closures): extract a bounded, content-aware view of
 * the DOM.
 *
 * The reader of `paragraphs`/`markdown` is a machine putting the page into a
 * context window, so the walk skips chrome (nav/header/footer/aside/cookie
 * banners/search) and picks the densest content container when the page has
 * one, instead of dumping the whole body. `links`/`images` still list the whole
 * page — callers that want content-only can intersect with `content.source`.
 * An optional word budget cuts the content at a block boundary.
 */
function extractStructureFromDom(maxContentWords: number | null): PageStructure {
  const MAX_BLOCKS = 2_000;
  const MAX_CANDIDATES_PER_SELECTOR = 25;
  // Semantic markup is a deliberate signal, so it is trusted on almost any
  // content; the heuristic containers have to earn it with volume.
  const MIN_SEMANTIC_CHARS = 80;
  const MIN_HEURISTIC_CHARS = 300;
  const MAX_MARKDOWN_LINES = 500;
  const clean = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const wordsOf = (text: string): number => text.split(/\s+/).filter((word) => word !== '').length;
  const classHint = (el: Element): string => `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;

  // Page chrome: structural tags, ARIA roles, and the usual class/id tells.
  const CHROME_TAGS = ['NAV', 'HEADER', 'FOOTER', 'ASIDE', 'FORM', 'DIALOG', 'TEMPLATE', 'BUTTON', 'SELECT'];
  const CHROME_ROLES = [
    'navigation', 'banner', 'contentinfo', 'search', 'complementary', 'form', 'menu', 'menubar', 'dialog', 'alert',
  ];
  const CHROME_HINT =
    /(^|[\s\-_])(nav|navbar|menu|sidebar|footer|header|banner|cookie|consent|gdpr|advert|ads?|sponsor|promo|newsletter|subscribe|social|share|related|recommend|comment|breadcrumb|pagination|masthead|toolbar|modal|popup|overlay|paywall|skip)([\s\-_]|$)/i;
  const isChrome = (el: Element): boolean => {
    if (CHROME_TAGS.indexOf(el.tagName) !== -1) return true;
    const role = (el.getAttribute('role') ?? '').toLowerCase();
    if (role !== '' && CHROME_ROLES.indexOf(role) !== -1) return true;
    if (el.getAttribute('aria-hidden') === 'true') return true;
    if (el.getAttribute('hidden') !== null) return true;
    return CHROME_HINT.test(classHint(el));
  };
  const inChrome = (el: Element): boolean => {
    for (let node: Element | null = el; node !== null; node = node.parentElement) {
      if (isChrome(node)) return true;
    }
    return false;
  };

  /** Content blocks (document order) under `root`, chrome subtrees skipped. */
  const blocksIn = (root: Element): Element[] => {
    const all = root.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,pre,td');
    const out: Element[] = [];
    for (let i = 0; i < all.length && out.length < MAX_BLOCKS; i += 1) {
      const el = all[i];
      if (el === undefined || inChrome(el)) continue;
      out.push(el);
    }
    return out;
  };

  /**
   * Readability-lite: characters of real prose, minus link density (menus and
   * link farms score badly even when they are text-heavy).
   */
  const scoreOf = (root: Element): number => {
    let chars = 0;
    let linkChars = 0;
    for (const el of blocksIn(root)) {
      if (/^H[1-4]$/.test(el.tagName)) continue;
      const text = clean(el);
      chars += text.length;
      for (const anchor of Array.from(el.querySelectorAll('a'))) linkChars += clean(anchor).length;
    }
    if (chars === 0) return 0;
    return Math.round(chars * (1 - Math.min(0.9, linkChars / chars)));
  };

  const SEMANTIC_SELECTORS = ['article', 'main', '[role=main]'];
  const HEURISTIC_SELECTORS = [
    '.post-content', '.entry-content', '.article-body', '.article__body', '#content', '.content', 'section',
  ];
  const pickBest = (selectors: readonly string[]): { el: Element; source: string; score: number } | null => {
    let best: { el: Element; source: string; score: number } | null = null;
    for (const selector of selectors) {
      const found = document.querySelectorAll(selector);
      const limit = Math.min(found.length, MAX_CANDIDATES_PER_SELECTOR);
      for (let i = 0; i < limit; i += 1) {
        const el = found[i];
        if (el === undefined || inChrome(el)) continue;
        const score = scoreOf(el);
        if (best === null || score > best.score) best = { el, source: selector, score };
      }
    }
    return best;
  };
  const semantic = pickBest(SEMANTIC_SELECTORS);
  const heuristic = pickBest(HEURISTIC_SELECTORS);
  const chosen =
    semantic !== null && semantic.score >= MIN_SEMANTIC_CHARS
      ? semantic
      : heuristic !== null && heuristic.score >= MIN_HEURISTIC_CHARS
        ? heuristic
        : null;
  const root: Element = chosen !== null ? chosen.el : document.body ?? document.documentElement;
  const source = chosen !== null ? chosen.source : 'body';

  // Apply the word budget across the selected blocks, so `paragraphs` and
  // `markdown` always describe the same slice of the page.
  const budget = maxContentWords !== null && maxContentWords > 0 ? maxContentWords : null;
  const selected: Element[] = [];
  let contentWords = 0;
  let truncated = false;
  for (const el of blocksIn(root)) {
    const words = wordsOf(clean(el));
    if (budget !== null && contentWords + words > budget) {
      truncated = true;
      break;
    }
    selected.push(el);
    contentWords += words;
  }

  const headings = selected
    .filter((el) => /^H[1-3]$/.test(el.tagName))
    .slice(0, 50)
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: clean(h).slice(0, 300) }))
    .filter((h) => h.text !== '');
  const paragraphs = selected
    .filter((el) => el.tagName === 'P')
    .slice(0, 100)
    .map((p) => clean(p).slice(0, 1000))
    .filter((text) => text !== '');
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .slice(0, 200)
    .map((a) => ({ href: a.href, text: clean(a).slice(0, 200) }));
  const images = Array.from(document.querySelectorAll('img'))
    .slice(0, 100)
    .map((i) => ({ src: i.currentSrc || i.src, alt: (i.alt ?? '').slice(0, 200) }))
    .filter((i) => i.src !== '');
  const metaContent = (name: string): string => {
    const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
    return el?.getAttribute('content')?.slice(0, 500) ?? '';
  };
  const bodyText = document.body?.innerText ?? '';
  // Markdown is the LM payload: the selected blocks in document order, then the
  // images of the content area (alt text matters to a vision step). Anchors are
  // left inline in the prose instead of being duplicated as their own lines —
  // the full link list is still available in `links`.
  const buildMarkdown = (): string => {
    const lines: string[] = [];
    for (const el of selected) {
      const tag = el.tagName;
      const text = clean(el);
      if (/^H[1-6]$/.test(tag)) {
        if (text !== '') lines.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
      } else if (text !== '') {
        lines.push(text);
      }
      if (lines.length >= MAX_MARKDOWN_LINES) break;
    }
    for (const img of Array.from(root.querySelectorAll('img'))) {
      if (inChrome(img)) continue;
      const src = img.getAttribute('src') ?? '';
      const alt = (img.getAttribute('alt') ?? '').slice(0, 200);
      if (src !== '') lines.push(`![${alt}](${src})`);
      if (lines.length >= MAX_MARKDOWN_LINES) break;
    }
    return lines.slice(0, MAX_MARKDOWN_LINES).join('\n\n');
  };
  const firstH1 = selected.find((el) => el.tagName === 'H1');
  const titleText = document.title !== '' ? document.title : firstH1 !== undefined ? clean(firstH1).slice(0, 300) : '';
  return {
    title: titleText,
    description: metaContent('description'),
    headings,
    paragraphs,
    links,
    images,
    wordCount: bodyText.split(/\s+/).filter((word) => word !== '').length,
    markdown: buildMarkdown(),
    content: { source, words: contentWords, truncated },
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
