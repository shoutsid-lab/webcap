import { newContext } from './browser.js';
import { CaptureError } from './errors.js';
import { DEFAULT_CAPTURE_TIMEOUT_CAP_MS, DEFAULT_CAPTURE_TIMEOUT_MS } from '../config.js';

export type CaptureFormat = 'png' | 'jpeg' | 'pdf';

export interface CaptureOptions {
  readonly timeoutMs?: number;
  readonly fullPage?: boolean;
  readonly includeHtml?: boolean;
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
  readonly wordCount: number;
  readonly markdown: string;
}

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

function resolveTimeout(req: CaptureRequest, timeouts?: CaptureTimeouts): number {
  const requested = req.options?.timeoutMs ?? timeouts?.defaultMs ?? DEFAULT_CAPTURE_TIMEOUT_MS;
  return Math.min(requested, timeouts?.capMs ?? DEFAULT_CAPTURE_TIMEOUT_CAP_MS);
}

export async function capture(req: CaptureRequest, timeouts?: CaptureTimeouts): Promise<CaptureResult> {
  const format: CaptureFormat = req.format ?? 'png';
  try {
    const context = await newContext();
    try {
      const page = await context.newPage();
      try {
        await page.goto(req.url, { timeout: resolveTimeout(req, timeouts), waitUntil: 'load' });
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
    const context = await newContext();
    try {
      const page = await context.newPage();
      try {
        await page.goto(req.url, { timeout: resolveTimeout(req, timeouts), waitUntil: 'load' });
        const structure = await page.evaluate(extractStructureFromDom);
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
 * (no Node imports or outer closures): extract a bounded structured view of the DOM.
 */
function extractStructureFromDom(): PageStructure {
  const clean = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .slice(0, 50)
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: clean(h).slice(0, 300) }))
    .filter((h) => h.text !== '');
  const paragraphs = Array.from(document.querySelectorAll('p'))
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
  const buildMarkdown = (root: Element): string => {
    const lines: string[] = [];
    const visit = (el: Element): void => {
      for (const child of Array.from(el.children)) {
        const tag = child.tagName;
        if (/^H[1-6]$/.test(tag)) {
          const text = clean(child);
          if (text !== '') lines.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
        } else if (tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE') {
          const text = clean(child);
          if (text !== '') lines.push(text);
        } else if (tag === 'IMG') {
          const src = child.getAttribute('src') ?? '';
          const alt = (child.getAttribute('alt') ?? '').slice(0, 200);
          if (src !== '') lines.push(`![${alt}](${src})`);
        } else if (tag === 'A') {
          const href = child.getAttribute('href') ?? '';
          const text = clean(child);
          if (text !== '' && href !== '' && href !== '#') lines.push(`[${text}](${href})`);
        } else if (tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'NOSCRIPT' && tag !== 'IFRAME') {
          visit(child);
        }
      }
    };
    visit(root);
    return lines.slice(0, 500).join('\n\n');
  };
  return {
    title: document.title ?? '',
    description: metaContent('description'),
    headings,
    paragraphs,
    links,
    images,
    wordCount: bodyText.split(/\s+/).filter((word) => word !== '').length,
    markdown: buildMarkdown(document.body ?? document.documentElement),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
