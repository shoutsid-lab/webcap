import { newContext } from './browser.js';
import { CaptureError } from './errors.js';
import { DEFAULT_CAPTURE_TIMEOUT_MS } from '../config.js';
import type { CaptureTimeouts } from './pipeline.js';

export interface OgResult {
  readonly url: string;
  readonly title?: string;
  readonly description?: string;
  readonly image?: string;
  readonly icon?: string;
}

export async function ogMetadata(req: { readonly url: string }, timeouts?: CaptureTimeouts): Promise<OgResult> {
  const html = await fetchHtml(req.url, timeouts);
  return {
    url: req.url,
    title: metaContent(html, 'og:title') ?? tagContent(html, 'title'),
    description: metaContent(html, 'og:description'),
    image: metaContent(html, 'og:image'),
    icon: iconHref(html),
  };
}

async function fetchHtml(url: string, timeouts?: CaptureTimeouts): Promise<string> {
  try {
    const context = await newContext();
    try {
      const page = await context.newPage();
      try {
        await page.goto(url, { timeout: timeouts?.defaultMs ?? DEFAULT_CAPTURE_TIMEOUT_MS, waitUntil: 'load' });
        return await page.content();
      } finally {
        await page.close();
      }
    } finally {
      await context.close();
    }
  } catch (err) {
    if (err instanceof CaptureError) throw err;
    throw new CaptureError(`og fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
}

function metaContent(html: string, property: string): string | undefined {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]*>`, 'i'));
  if (tag === null) return undefined;
  const content = tag[0].match(/content\s*=\s*["']([^"']*)["']/i);
  const value = content === null ? undefined : clean(content[1]);
  return value === '' ? undefined : value;
}

function tagContent(html: string, tag: string): string | undefined {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (match === null || match[1] === undefined) return undefined;
  const text = clean(match[1]);
  return text === '' ? undefined : text;
}

function iconHref(html: string): string | undefined {
  const match = html.match(/<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*>/i);
  if (match === null) return undefined;
  const href = match[0].match(/href\s*=\s*["']([^"']*)["']/i);
  return href === null || href[1] === undefined ? undefined : clean(href[1]);
}

function clean(value: string | undefined): string {
  return (value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}
