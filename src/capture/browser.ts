import { chromium, type Browser, type BrowserContext } from 'playwright-core';

let browser: Browser | null = null;

/** Lazy singleton Chromium (system Chrome channel, headless, no sandbox). */
export async function getBrowser(): Promise<Browser> {
  if (browser === null) {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browser;
}

/** Viewport/mobile context options passed through to the Playwright browser context. */
export interface ContextViewportOptions {
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly userAgent?: string;
  readonly deviceScaleFactor?: number;
  readonly isMobile?: boolean;
  /** Outbound proxy server URL (undefined = direct). Resolved via resolveProxyServer. */
  readonly proxyServer?: string;
  /** Hardened stealth context: realistic UA/viewport defaults + webdriver mask. No third-party plugin. */
  readonly stealth?: boolean;
}

/**
 * Resolve a capture proxy option to a Playwright proxy server URL.
 * 'auto' uses WEBCAP_PROXY_URL when set, else direct (undefined); 'stealth'
 * routes the same way (hardening is orthogonal, via `stealth: true`); an
 * explicit URL string is used verbatim.
 */
export function resolveProxyServer(proxy: 'auto' | 'stealth' | string): string | undefined {
  if (proxy === 'auto' || proxy === 'stealth') {
    const env = (process.env.WEBCAP_PROXY_URL ?? '').trim();
    return env !== '' ? env : undefined;
  }
  return proxy;
}

/** Realistic desktop Chrome UA applied when stealth sets no explicit userAgent. */
export const STEALTH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Realistic desktop viewport applied when stealth sets no explicit viewport. */
export const STEALTH_VIEWPORT = { width: 1366, height: 768 } as const;

/** Fresh, isolated context for one capture/OG operation. */
export async function newContext(opts?: ContextViewportOptions): Promise<BrowserContext> {
  const stealth = opts?.stealth === true;
  const context = await (await getBrowser()).newContext({
    viewport: opts?.viewport ?? (stealth ? { ...STEALTH_VIEWPORT } : undefined),
    userAgent: opts?.userAgent ?? (stealth ? STEALTH_USER_AGENT : undefined),
    deviceScaleFactor: opts?.deviceScaleFactor,
    isMobile: opts?.isMobile,
    ...(opts?.proxyServer !== undefined ? { proxy: { server: opts.proxyServer } } : {}),
  });
  if (stealth) {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }
  return context;
}

/** Close the shared browser (service shutdown / test teardown). */
export async function closeBrowser(): Promise<void> {
  const current = browser;
  browser = null;
  if (current !== null) await current.close();
}
