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

/** Fresh, isolated context for one capture/OG operation. */
export async function newContext(): Promise<BrowserContext> {
  return (await getBrowser()).newContext();
}

/** Close the shared browser (service shutdown / test teardown). */
export async function closeBrowser(): Promise<void> {
  const current = browser;
  browser = null;
  if (current !== null) await current.close();
}
