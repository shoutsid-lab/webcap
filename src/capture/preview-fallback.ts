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
 */
import { CaptureError } from './errors.js';
import type { PageStructure } from './pipeline.js';

/**
 * Fetch timeout for the HTTP-only fallback.
 * Budget: browser timeout (15s) + this fallback must stay under 35s (client AbortController).
 * With MAX_RETRIES=1: 15s browser + 2×8s fallback = 31s total — safely under 35s.
 * Previous config (10s × 3 attempts = 30s fallback) could total 50s, exceeding
 * the client's AbortController and causing false "timeout" errors on HN and other sites.
 */
const FETCH_TIMEOUT_MS = 8_000;

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
        // Exponential backoff: 500ms, 1000ms, 2000ms (keep total under budget)
        const backoffMs = Math.min(500 * Math.pow(2, attempt), 2000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  if (lastError || !response) {
    throw new CaptureError(`preview fallback fetch failed for ${url} after ${MAX_RETRIES + 1} attempts: ${lastError?.message ?? 'unknown error'}`, { cause: lastError });
  }

  if (!response.ok) {
    throw new CaptureError(`preview fallback fetch returned HTTP ${response.status} for ${url}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new CaptureError(`preview fallback: unsupported content-type ${contentType} for ${url}`);
  }

  const html = await response.text();
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

/** Parse raw HTML into a PageStructure approximation. */
function parseHtmlToStructure(html: string, url: string): PageStructure {
  // Title: <title> tag or og:title
  const title = metaContent(html, 'og:title') || extractTagText(html, 'title') || '';

  // Description: og:description or meta description
  const description = metaContent(html, 'og:description') || metaContent(html, 'description') || '';

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

  // Body text for word count
  const bodyText = extractTagText(html, 'body');

  // Build markdown-like output from headings and paragraphs
  const lines: string[] = [];
  const paragraphRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = paragraphRegex.exec(html)) !== null) {
    const text = stripTags(pMatch[1] ?? '').trim().slice(0, 1000);
    if (text !== '') lines.push(text);
  }

  // Interleave headings into the markdown output
  const markdownParts: string[] = [];
  const allElements: Array<{ position: number; text: string; isHeading: boolean; level?: number }> = [];

  // Find positions of headings in the HTML
  const hRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let hMatch;
  while ((hMatch = hRegex.exec(html)) !== null) {
    const level = parseInt(hMatch[1] ?? '1', 10);
    const text = stripTags(hMatch[2] ?? '').trim().slice(0, 300);
    if (text !== '') allElements.push({ position: hMatch.index, text, isHeading: true, level });
  }

  // Find positions of paragraphs
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = pRegex.exec(html)) !== null) {
    const text = stripTags(pm[1] ?? '').trim().slice(0, 1000);
    if (text !== '') allElements.push({ position: pm.index, text, isHeading: false });
  }

  // Sort by position and build markdown
  allElements.sort((a, b) => a.position - b.position);
  for (const el of allElements) {
    if (el.isHeading) {
      markdownParts.push(`${'#'.repeat(el.level!)} ${el.text}`);
    } else {
      markdownParts.push(el.text);
    }
  }

  const markdown = markdownParts.slice(0, 500).join('\n\n');

  return {
    title,
    description,
    headings: headings.slice(0, 50),
    paragraphs: lines.slice(0, 100),
    links: links.slice(0, 200),
    images: images.slice(0, 100),
    wordCount: bodyText.split(/\s+/).filter((w) => w !== '').length,
    markdown,
  };
}
