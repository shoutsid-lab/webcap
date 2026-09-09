import { chromium } from 'playwright-core';

const BASE = 'http://localhost:8080';
const out = '/home/shoutsid/code/webcap/screenshots';

const browser = await chromium.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-setuid-sandbox'] });

// Pages to screenshot
const pages = [
  { name: 'landing', url: `${BASE}/` },
  { name: 'og-debugger', url: `${BASE}/og-debugger` },
  { name: 'og-debugger-with-url', url: `${BASE}/og-debugger?url=https://github.com` },
];

for (const { name, url } of pages) {
  // Light theme
  const ctxLight = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const pageLight = await ctxLight.newPage();
  await pageLight.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await pageLight.waitForTimeout(500);
  await pageLight.screenshot({ path: `${out}/${name}-light.png`, fullPage: true });
  await ctxLight.close();

  // Dark theme
  const ctxDark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const pageDark = await ctxDark.newPage();
  await pageDark.goto(url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await pageDark.waitForTimeout(500);
  await pageDark.screenshot({ path: `${out}/${name}-dark.png`, fullPage: true });
  await ctxDark.close();

  console.log(`✓ ${name} (light + dark)`);
}

// Mobile view of landing
const ctxMobile = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'light', isMobile: true });
const pageMobile = await ctxMobile.newPage();
await pageMobile.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
await pageMobile.waitForTimeout(500);
await pageMobile.screenshot({ path: `${out}/landing-mobile-light.png`, fullPage: true });
await ctxMobile.close();
console.log('✓ landing mobile light');

const ctxMobileDark = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'dark', isMobile: true });
const pageMobileDark = await ctxMobileDark.newPage();
await pageMobileDark.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
await pageMobileDark.waitForTimeout(500);
await pageMobileDark.screenshot({ path: `${out}/landing-mobile-dark.png`, fullPage: true });
await ctxMobileDark.close();
console.log('✓ landing mobile dark');

await browser.close();
console.log('All screenshots saved to', out);
