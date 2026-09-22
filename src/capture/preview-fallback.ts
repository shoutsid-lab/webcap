/**
 * Lightweight HTTP-only preview fallback: fetches a page via plain HTTP and
 * extracts structure from raw HTML without spinning up Playwright/Chromium.
 *
 * Used by the /v1/extract/preview route when the browser capture fails
 * (timeout, crash, blocked site). This gives a degraded-but-functional
 * result instead of a hard 502 error.
 *
 * Limitations vs the full browser capture:
 * - No JavaScript rendering (SPA content missing)
 * - No dynamic DOM (React/Vue/Angular pages return empty)
 * - Markdown is a rough HTML→text approximation
 * - No anti-bot bypass (stealth mode not applicable)
 * - Content selection is regex-based (first <article>/<main> region, tag-level
 *   chrome removal): nested same-tag cases can leave residue, where the browser
 *   path scores the real DOM. It still beats shipping cookie banners as content.
 */
import { CaptureError } from './errors.js';
import type { PageStructure } from './pipeline.js';
import { lookup } from 'node:dns';

/**
 * Fetch timeout for the HTTP-only fallback.
 * Budget: the entire preview pipeline must complete within ~35s (client AbortController
 * is 45s; we leave 10s margin for network round-trip and server processing).
 *
 * With MAX_RETRIES=1: 12s×2 attempts = 24s max (with 300ms backoff).
 * Browser fallback adds ~12s. Total worst case: ~36s (within 45s budget).
 * If we used 3 attempts (36s) + browser (12s) = 48s, exceeding client timeout.
 */
const FETCH_TIMEOUT_MS = 12_000;

/** Maximum number of retry attempts for transient network errors (0 = one attempt). */
const MAX_RETRIES = 1;

/** User-agent rotation to avoid blocks from sites that filter by UA. */
const USER_AGENTS: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
];

/**
 * Attempt a lightweight HTTP fetch + HTML parse to produce a PageStructure.
 * Throws CaptureError on network failure so the caller can map it consistently.
 * Retries up to MAX_RETRIES times on transient network errors with user-agent rotation.
 */
export async function previewFallback(url: string): Promise<PageStructure> {
  /* DNS pre-check: fail fast on invalid/unresolvable domains instead of
     waiting the full 15s fetch timeout. This converts slow 502s into
     fast, informative errors and improves the preview success rate by
     letting the caller return a useful error message immediately. */
  try {
    const hostname = new URL(url).hostname;
    await new Promise<void>((resolve, reject) => {
      lookup(hostname, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (dnsErr) {
    throw new CaptureError(`DNS resolution failed for ${url}: ${dnsErr instanceof Error ? dnsErr.message : String(dnsErr)}`);
  }

  let response: Response | undefined;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      // Rotate user-agents to avoid blocks from sites that filter by UA
      const userAgent = USER_AGENTS[attempt % USER_AGENTS.length] ?? USER_AGENTS[0]!;
      try {
        response = await fetch(url, {
          signal: ac.signal,
          headers: {
            'user-agent': userAgent,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'accept-language': 'en-US,en;q=0.5',
            'accept-encoding': 'gzip, deflate',
          },
          redirect: 'follow',
        });
      } finally {
        clearTimeout(timer);
      }
      lastError = undefined;
      break; // Success
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 300ms (keep total under 35s budget)
        const backoffMs = Math.min(300 * Math.pow(2, attempt), 800);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  if (lastError || !response) {
    throw new CaptureError(`preview fallback fetch failed for ${url} after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`, { cause: lastError });
  }

  if (!response.ok) {
    /* Try to extract whatever we can from error pages — many still have
       useful HTML (e.g., 403/404 pages with titles, 502 pages with info).
       Only throw if the body is empty or too short to be useful. */
    const errHtml = await response.text().catch(() => '');
    if (errHtml.length > 200) {
      /* Parse the error page — it might have useful structure */
      return parseHtmlToStructure(errHtml, url);
    }
    throw new CaptureError(`preview fallback fetch returned HTTP ${response.status} for ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const html = await response.text();

  /* Handle non-HTML content types gracefully — return minimal structure
     with raw text as markdown instead of throwing. This converts some
     502 errors into degraded-but-functional previews. */
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    const title = html.slice(0, 200).replace(/\n/g, ' ').trim() || url;
    const wordCount = html.split(/\s+/).filter((w) => w !== '').length;
    return {
      title,
      description: '',
      headings: [],
      paragraphs: [html.slice(0, 1000)],
      links: [],
      images: [],
      wordCount,
      markdown: html.slice(0, 2000),
    };
  }

  return parseHtmlToStructure(html, url);
}

/** Decode common HTML entities. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

/** Extract a meta tag content value by property or name. */
function metaContent(html: string, name: string): string {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${name}["'][^>]*>`, 'i'));
  if (tag === null) return '';
  const content = tag[0].match(/content\s*=\s*["']([^"']*)["']/i);
  return content?.[1] !== undefined ? decodeEntities(content[1]).trim() : '';
}

/** Strip HTML tags and return plain text. */
function stripTags(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract text from inside a specific tag. */
function extractTagText(html: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = html.match(regex);
  return match?.[1] !== undefined ? stripTags(match[1]) : '';
}

/**
 * Structural chrome: whole regions that are never the document. Removed before
 * parsing so the preview (the free "try before you buy" surface an agent reads
 * first) does not hand back nav links and cookie notices as page content.
 * Requires a matching close tag; an unclosed tag is left alone rather than
 * swallowing the rest of the document.
 */
const CHROME_BLOCKS = /<(nav|header|footer|aside|form|noscript|template|dialog|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** First region of `tag`, or null. Regex-based: no nesting support (see header). */
function regionOf(html: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i').exec(html);
  return match?.[1] ?? null;
}

function wordsIn(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/**
 * Parse raw HTML into a PageStructure approximation.
 * Exported for tests: pure function, no I/O.
 */
export function parseHtmlToStructure(html: string, url: string): PageStructure {
  // Whole-page word count first (matches the browser path's `wordCount`).
  const wholePageWords = wordsIn(extractTagText(html, 'body'));
  // Content scope: chrome removed, then the article/main region when the page
  // marks one up (else the chrome-stripped document, reported as 'body').
  const stripped = html.replace(CHROME_BLOCKS, ' ');
  const articleRegion = regionOf(stripped, 'article');
  const mainRegion = articleRegion === null ? regionOf(stripped, 'main') : null;
  const scope = articleRegion ?? mainRegion ?? stripped;
  const contentSource = articleRegion !== null ? 'article' : mainRegion !== null ? 'main' : 'body';
  // Meta lives in <head>, i.e. outside the content scope, so title/description
  // are read from the full document.
  // Title: <title> tag or og:title
  const title = metaContent(html, 'og:title') || extractTagText(html, 'title') || '';

  // Description: og:description or meta description
  const description = metaContent(html, 'og:description') || metaContent(html, 'description') || '';

  // Everything below is content, so it reads the chrome-free scope.
  html = scope;

  // Headings: extract h1, h2, h3 from raw HTML
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: { level: number; text: string }[] = [];
  let headingMatch;
  while ((headingMatch = headingRegex.exec(html)) !== null) {
    const level = parseInt(headingMatch[1] ?? '1', 10);
    const text = stripTags(headingMatch[2] ?? '').trim().slice(0, 300);
    if (text !== '') headings.push({ level, text });
  }

  // Links: extract <a href="...">text</a>
  const linkRegex = /<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const links: { href: string; text: string }[] = [];
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    let href = decodeEntities(linkMatch[1] ?? '').trim();
    const text = stripTags(linkMatch[2] ?? '').trim().slice(0, 200);
    if (href === '' || href === '#' || href.startsWith('javascript:')) continue;
    // Resolve relative URLs
    if (!href.startsWith('http')) {
      try {
        href = new URL(href, url).href;
      } catch { continue; }
    }
    if (text !== '' || href !== '') links.push({ href, text: text || href });
  }

  // Images: extract <img src="..." alt="...">
  const imgRegex = /<img\s+[^>]*src\s*=\s*["']([^"']*)["'][^>]*(?:alt\s*=\s*["']([^"']*)["'])?[^>]*\/?>/gi;
  const images: { src: string; alt: string }[] = [];
  let imgMatch;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    let src = decodeEntities(imgMatch[1] ?? '').trim();
    const alt = (imgMatch[2] ?? '').trim().slice(0, 200);
    if (src === '') continue;
    if (!src.startsWith('http')) {
      try {
        src = new URL(src, url).href;
      } catch { continue; }
    }
    images.push({ src, alt });
  }



  // Paragraphs (for the `paragraphs` array) — prose only, as in the browser path.
  const lines: string[] = [];
  const paragraphRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = paragraphRegex.exec(html)) !== null) {
    const text = stripTags(pMatch[1] ?? '').trim().slice(0, 1000);
    if (text !== '') lines.push(text);
  }

  // Markdown: headings + prose blocks in document order. Lists count as content
  // here (a page that presents everything as <li> is still a document), and
  // chrome was already removed from `html` above.
  const markdownParts: string[] = [];
  const allElements: Array<{ position: number; text: string; isHeading: boolean; level?: number }> = [];

  const collect = (regex: RegExp, transform: (match: RegExpExecArray) => { text: string; blank: boolean }): void => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const { text, blank } = transform(match);
      if (!blank) allElements.push({ position: match.index, text, isHeading: false });
    }
  };

  // Headings first (they need the level, so they are collected separately).
  const hRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch;
  while ((hMatch = hRegex.exec(html)) !== null) {
    const level = parseInt(hMatch[1] ?? '1', 10);
    const text = stripTags(hMatch[2] ?? '').trim().slice(0, 300);
    if (text !== '') allElements.push({ position: hMatch.index, text, isHeading: true, level });
  }
  collect(/<p[^>]*>([\s\S]*?)<\/p>/gi, (m) => ({ text: stripTags(m[1] ?? '').trim().slice(0, 1000), blank: false }));
  collect(/<li[^>]*>([\s\S]*?)<\/li>/gi, (m) => ({ text: stripTags(m[1] ?? '').trim().slice(0, 1000), blank: false }));
  collect(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (m) => ({ text: stripTags(m[1] ?? '').trim().slice(0, 1000), blank: false }));

  // Sort by position and build markdown
  allElements.sort((a, b) => a.position - b.position);
  for (const el of allElements) {
    if (el.isHeading) {
      markdownParts.push(`${'#'.repeat(el.level!)} ${el.text}`);
    } else {
      markdownParts.push(el.text);
    }
  }

  // Pages that mark up content without <p>/<li> (table- and div-driven layouts)
  // would otherwise preview as empty. Degrade to plain text of the scope rather
  // than handing an agent nothing.
  if (markdownParts.length === 0) {
    const text = stripTags(scope).trim();
    if (text !== '') markdownParts.push(text.slice(0, 4_000));
  }

  const markdown = markdownParts.slice(0, 500).join('\n\n');

  return {
    title,
    description,
    headings: headings.slice(0, 50),
    paragraphs: lines.slice(0, 100),
    links: links.slice(0, 200),
    images: images.slice(0, 100),
    wordCount: wholePageWords,
    markdown,
    content: { source: contentSource, words: wordsIn(markdownParts.join(' ')), truncated: false },
  };
}
