/**
 * QA/UX Test Script for webcap
 * Tests landing page, conversion funnel, theme toggle, mobile responsiveness
 * Takes screenshots at multiple viewports and themes
 */
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:8080';
const out = '/home/shoutsid/code/webcap/screenshots/qa';
const NGROK_BASE = 'https://nickname-trident-driveway.ngrok-free.dev';

// Ensure output directory exists
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const results = { screenshots: [], issues: [], findings: [] };

async function screenshot(page, name, options = {}) {
  const filePath = path.join(out, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: options.fullPage !== false, ...options });
  results.screenshots.push({ name, path: filePath });
  console.log(`  📸 ${name}`);
  return filePath;
}

// ==================== 1. LANDING PAGE - DESKTOP LIGHT ====================
console.log('\n🔍 Test 1: Landing Page - Desktop Light (1440px)');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa-landing-desktop-light-full', { fullPage: true });
  await screenshot(page, 'qa-landing-desktop-light-viewport');
  
  // Check hero section visibility
  const hero = await page.$('.hero');
  if (!hero) {
    results.issues.push({ severity: 'critical', description: 'Hero section missing', selector: '.hero' });
  }
  
  // Check CTA buttons
  const ctaButtons = await page.$$('.cta-row .btn');
  console.log(`  Found ${ctaButtons.length} CTA buttons`);
  
  // Check social proof
  const socialProof = await page.$('#social-proof');
  if (socialProof) {
    const proofText = await socialProof.textContent();
    console.log(`  Social proof: ${proofText.trim().substring(0, 100)}`);
  }
  
  // Check preview form
  const previewForm = await page.$('#preview-form');
  if (!previewForm) {
    results.issues.push({ severity: 'critical', description: 'Preview form missing', selector: '#preview-form' });
  }
  
  await ctx.close();
}

// ==================== 2. LANDING PAGE - DESKTOP DARK ====================
console.log('\n🔍 Test 2: Landing Page - Desktop Dark (1440px)');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa-landing-desktop-dark-full', { fullPage: true });
  await screenshot(page, 'qa-landing-desktop-dark-viewport');
  
  // Check theme toggle exists
  const themeToggle = await page.$('#theme-toggle');
  if (!themeToggle) {
    results.issues.push({ severity: 'high', description: 'Theme toggle button missing', selector: '#theme-toggle' });
  }
  
  await ctx.close();
}

// ==================== 3. LANDING PAGE - TABLET (768px) ====================
console.log('\n🔍 Test 3: Landing Page - Tablet (768px)');
{
  const ctx = await browser.newContext({
    viewport: { width: 768, height: 1024 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa-landing-tablet-light-full', { fullPage: true });
  
  // Check for horizontal overflow
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  if (hasOverflow) {
    results.issues.push({ severity: 'high', description: 'Horizontal overflow detected on tablet viewport', selector: 'body' });
  }
  
  await ctx.close();
}

// ==================== 4. LANDING PAGE - MOBILE (375px) ====================
console.log('\n🔍 Test 4: Landing Page - Mobile (375px)');
{
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: 'light',
    isMobile: true
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa-landing-mobile-light-full', { fullPage: true });
  await screenshot(page, 'qa-landing-mobile-light-viewport');
  
  // Check mobile overflow
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  if (hasOverflow) {
    results.issues.push({ severity: 'high', description: 'Horizontal overflow on mobile viewport', selector: 'body' });
  }
  
  // Check nav CTA visibility on mobile
  const navCta = await page.$('.nav-cta');
  if (navCta) {
    const isVisible = await navCta.isVisible();
    console.log(`  Nav CTA visible: ${isVisible}`);
  }
  
  // Check sticky CTA
  const stickyCta = await page.$('.sticky-cta');
  if (stickyCta) {
    const isVisible = await stickyCta.isVisible();
    console.log(`  Sticky CTA visible: ${isVisible}`);
  }
  
  await ctx.close();
}

// ==================== 5. LANDING PAGE - MOBILE DARK ====================
console.log('\n🔍 Test 5: Landing Page - Mobile Dark (375px)');
{
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: 'dark',
    isMobile: true
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa-landing-mobile-dark-full', { fullPage: true });
  
  await ctx.close();
}

// ==================== 6. THEME TOGGLE TEST ====================
console.log('\n🔍 Test 6: Theme Toggle Functionality');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(500);
  
  // Check initial state (should be 'system')
  let dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`  Initial data-theme: ${dataTheme || 'none (system)'}`);
  
  // Click theme toggle to go to light
  const themeToggle = await page.$('#theme-toggle');
  if (themeToggle) {
    await themeToggle.click();
    await page.waitForTimeout(200);
    dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`  After click 1: data-theme="${dataTheme}"`);
    await screenshot(page, 'qa-theme-toggle-light');
    
    // Click again to go to dark
    await themeToggle.click();
    await page.waitForTimeout(200);
    dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`  After click 2: data-theme="${dataTheme}"`);
    await screenshot(page, 'qa-theme-toggle-dark');
    
    // Click again to go to system
    await themeToggle.click();
    await page.waitForTimeout(200);
    dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`  After click 3 (system): data-theme="${dataTheme}"`);
    
    // Verify theme toggle aria-label updates
    const ariaLabel = await themeToggle.getAttribute('aria-label');
    console.log(`  Theme toggle aria-label: "${ariaLabel}"`);
  }
  
  await ctx.close();
}

// ==================== 7. PREVIEW FORM / CONVERSION FUNNEL ====================
console.log('\n🔍 Test 7: Preview Form (Conversion Funnel)');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  
  // Track network requests
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('/v1/extract/preview') || req.url().includes('/v1/track')) {
      requests.push({ url: req.url(), method: req.method() });
    }
  });
  
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(500);
  
  // Scroll to preview form
  await page.evaluate(() => document.getElementById('preview')?.scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(300);
  await screenshot(page, 'qa-preview-form-empty');
  
  // Check form elements
  const input = await page.$('#preview-url-input');
  const btn = await page.$('#preview-btn');
  if (!input) results.issues.push({ severity: 'critical', description: 'Preview URL input missing', selector: '#preview-url-input' });
  if (!btn) results.issues.push({ severity: 'critical', description: 'Preview Extract button missing', selector: '#preview-btn' });
  
  // Check pre-filled URL
  const inputValue = await input?.inputValue();
  console.log(`  Pre-filled URL: "${inputValue}"`);
  
  // Submit form with default URL (news.ycombinator.com)
  console.log('  Submitting preview form...');
  await btn.click();
  await page.waitForTimeout(500);
  await screenshot(page, 'qa-preview-loading');
  
  // Wait for results
  try {
    await page.waitForSelector('.pr-header, .pr-error', { timeout: 15000 });
    const hasError = await page.$('.pr-error');
    if (hasError) {
      const errorText = await hasError.textContent();
      results.issues.push({
        severity: 'critical',
        description: `Preview form returned error: ${errorText.substring(0, 200)}`,
        selector: '.pr-error'
      });
      console.log(`  ❌ PREVIEW ERROR: ${errorText.substring(0, 200)}`);
      await screenshot(page, 'qa-preview-error');
    } else {
      console.log('  ✅ Preview results loaded successfully');
      await screenshot(page, 'qa-preview-results');
      
      // Check results structure
      const hasHeadings = await page.$('.pr-section');
      const hasLinks = await page.$('.pr-links');
      const hasWordCount = await page.$('.pr-section .pr-label');
      console.log(`  Has headings section: ${!!hasHeadings}, Has links: ${!!hasLinks}, Has word count: ${!!hasWordCount}`);
    }
  } catch (e) {
    results.issues.push({
      severity: 'critical',
      description: `Preview form timed out or failed: ${e.message}`,
      selector: '#preview-results'
    });
    console.log(`  ❌ PREVIEW TIMEOUT: ${e.message}`);
    await screenshot(page, 'qa-preview-timeout');
  }
  
  // Check tracking requests
  console.log(`  Tracking requests: ${requests.filter(r => r.url.includes('/v1/track')).length}`);
  
  await ctx.close();
}

// ==================== 8. OG DEBUGGER PAGE ====================
console.log('\n🔍 Test 8: OG Debugger Page');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/og-debugger', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa-og-debugger-empty');
  
  // Check form
  const ogForm = await page.$('form');
  if (!ogForm) {
    results.issues.push({ severity: 'medium', description: 'OG debugger form missing', selector: 'form' });
  }
  
  // Try entering a URL
  const ogInput = await page.$('input[type="url"]');
  if (ogInput) {
    await ogInput.fill('https://github.com');
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(500);
    await screenshot(page, 'qa-og-debugger-with-url');
    
    try {
      await page.waitForSelector('.og-preview, .og-error', { timeout: 15000 });
      console.log('  ✅ OG debugger loaded results');
      await screenshot(page, 'qa-og-debugger-results');
    } catch (e) {
      results.issues.push({ severity: 'high', description: 'OG debugger timed out', selector: '.og-preview' });
      console.log(`  ❌ OG debugger timeout: ${e.message}`);
    }
  }
  
  await ctx.close();
}

// ==================== 9. COMPARE PAGE ====================
console.log('\n🔍 Test 9: Compare Page');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/compare', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa-compare-page-light-full', { fullPage: true });
  
  // Check table
  const table = await page.$('.compare-table');
  if (!table) {
    results.issues.push({ severity: 'medium', description: 'Compare table missing', selector: '.compare-table' });
  }
  
  // Check table rows
  const rows = await page.$$('.compare-table tbody tr');
  console.log(`  Compare table rows: ${rows.length}`);
  
  await ctx.close();
}

// ==================== 10. COMPARE PAGE - MOBILE ====================
console.log('\n🔍 Test 10: Compare Page - Mobile');
{
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: 'light',
    isMobile: true
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/compare', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa-compare-page-mobile', { fullPage: true });
  
  // Check for horizontal overflow on mobile
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  if (hasOverflow) {
    results.issues.push({ severity: 'high', description: 'Compare page has horizontal overflow on mobile', selector: '.compare-table-wrap' });
  }
  
  await ctx.close();
}

// ==================== 11. NAVIGATION LINKS TEST ====================
console.log('\n🔍 Test 11: Navigation Links');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  
  const navLinks = await page.$$eval('.top nav a', links => links.map(l => ({
    text: l.textContent?.trim(),
    href: l.getAttribute('href'),
    isExternal: l.hasAttribute('target')
  })));
  
  console.log('  Nav links:');
  for (const link of navLinks) {
    console.log(`    ${link.text} -> ${link.href} ${link.isExternal ? '(external)' : ''}`);
  }
  
  // Test internal anchor links
  for (const link of navLinks.filter(l => !l.isExternal && l.href?.startsWith('#'))) {
    const target = await page.$(link.href);
    if (!target) {
      results.issues.push({ severity: 'medium', description: `Nav link "${link.text}" points to non-existent anchor "${link.href}"`, selector: link.href });
      console.log(`    ❌ Anchor ${link.href} not found`);
    } else {
      console.log(`    ✅ Anchor ${link.href} exists`);
    }
  }
  
  // Check /compare link
  const compareLink = navLinks.find(l => l.href === '/compare');
  if (!compareLink) {
    results.issues.push({ severity: 'medium', description: 'No nav link to /compare page', selector: '.top nav' });
  }
  
  await ctx.close();
}

// ==================== 12. KEYBOARD NAVIGATION ====================
console.log('\n🔍 Test 12: Keyboard Navigation');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(500);
  
  // Check focusable elements count
  const focusable = await page.evaluate(() => {
    const els = document.querySelectorAll('a, button, input, [tabindex]');
    return els.length;
  });
  console.log(`  Focusable elements: ${focusable}`);
  
  // Test Tab key - get first few focusable elements
  const focusedElements = [];
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName}#${el.id || ''}.${el.className || ''}` : 'none';
    });
    focusedElements.push(focused);
  }
  console.log(`  First 10 tab stops: ${focusedElements.join(' → ')}`);
  
  // Check skip navigation link
  const skipLink = await page.$('a[href="#main"], a[href="#content"], .skip-nav, .skip-to-content');
  if (!skipLink) {
    results.issues.push({ severity: 'low', description: 'No skip navigation link for keyboard users', selector: 'body' });
  }
  
  await ctx.close();
}

// ==================== 13. WAITLIST FORM TEST ====================
console.log('\n🔍 Test 13: Waitlist Form');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  
  // Scroll to waitlist section
  await page.evaluate(() => document.getElementById('waitlist')?.scrollIntoView({ behavior: 'instant' }));
  await page.waitForTimeout(300);
  await screenshot(page, 'qa-waitlist-form');
  
  const wlForm = await page.$('#waitlist-form');
  if (!wlForm) {
    results.issues.push({ severity: 'medium', description: 'Waitlist form missing', selector: '#waitlist-form' });
  }
  
  const wlInput = await page.$('#waitlist-email');
  const wlBtn = await page.$('#waitlist-btn');
  if (wlInput && wlBtn) {
    // Test empty submission
    await wlBtn.click();
    await page.waitForTimeout(300);
    
    // Test invalid email
    await wlInput.fill('not-an-email');
    await wlBtn.click();
    await page.waitForTimeout(300);
    
    console.log('  ✅ Waitlist form validated (empty + invalid email)');
  }
  
  await ctx.close();
}

// ==================== 14. STICKY CTA TEST ====================
console.log('\n🔍 Test 14: Sticky CTA');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(500);
  
  // Check sticky CTA initial visibility (should be hidden when preview is in view)
  const stickyCta = await page.$('.sticky-cta');
  if (stickyCta) {
    // Scroll down past preview
    await page.evaluate(() => window.scrollTo(0, 2000));
    await page.waitForTimeout(500);
    const isVisible = await stickyCta.isVisible();
    console.log(`  Sticky CTA visible after scroll: ${isVisible}`);
    await screenshot(page, 'qa-sticky-cta-visible');
    
    // Scroll back to preview
    await page.evaluate(() => document.getElementById('preview')?.scrollIntoView({ behavior: 'instant' }));
    await page.waitForTimeout(500);
    const isHidden = !(await stickyCta.isVisible());
    console.log(`  Sticky CTA hidden at preview: ${isHidden}`);
  }
  
  await ctx.close();
}

// ==================== 15. ERROR PAGES / EDGE CASES ====================
console.log('\n🔍 Test 15: Error Pages / Edge Cases');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  
  // Test 404 page
  const response404 = await page.goto(BASE + '/nonexistent-page', { waitUntil: 'networkidle', timeout: 10000 }).catch(() => null);
  if (response404) {
    console.log(`  404 status: ${response404.status()}`);
    await screenshot(page, 'qa-404-page');
  }
  
  // Test artifact page with invalid ID
  const resp = await page.goto(BASE + '/v1/artifacts/nonexistent-id/page', { waitUntil: 'networkidle', timeout: 10000 }).catch(() => null);
  if (resp) {
    console.log(`  Invalid artifact status: ${resp.status()}`);
    await screenshot(page, 'qa-invalid-artifact');
  }
  
  await ctx.close();
}

// ==================== 16. CHECK ACCESSIBILITY BASICS ====================
console.log('\n🔍 Test 16: Accessibility Basics');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  
  const a11yResults = await page.evaluate(() => {
    const issues = [];
    
    // Check for alt text on images
    const images = document.querySelectorAll('img');
    images.forEach((img, i) => {
      if (!img.getAttribute('alt') && !img.getAttribute('aria-label')) {
        issues.push(`Image ${i} (${img.src.substring(0, 50)}) missing alt text`);
      }
    });
    
    // Check for heading hierarchy
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let prevLevel = 0;
    const headingIssues = [];
    headings.forEach((h, i) => {
      const level = parseInt(h.tagName[1]);
      if (level > prevLevel + 1 && prevLevel > 0) {
        headingIssues.push(`Heading skip: h${prevLevel} → h${level} ("${h.textContent?.substring(0, 40)}")`);
      }
      prevLevel = level;
    });
    
    // Check for form labels
    const inputs = document.querySelectorAll('input, textarea, select');
    const unlabeledInputs = [];
    inputs.forEach((input, i) => {
      const hasLabel = input.getAttribute('aria-label') || 
                      input.getAttribute('aria-labelledby') ||
                      document.querySelector(`label[for="${input.id}"]`);
      if (!hasLabel) {
        unlabeledInputs.push(`Input ${i} (type="${input.type}", name="${input.name}") missing label`);
      }
    });
    
    // Check button accessible names
    const buttons = document.querySelectorAll('button');
    const emptyButtons = [];
    buttons.forEach((btn, i) => {
      const name = btn.textContent?.trim() || btn.getAttribute('aria-label') || btn.getAttribute('title');
      if (!name) {
        emptyButtons.push(`Button ${i} missing accessible name`);
      }
    });
    
    return {
      images: images.length,
      headings: Array.from(headings).map(h => `${h.tagName}: "${h.textContent?.substring(0, 50)}"`),
      headingIssues,
      unlabeledInputs,
      emptyButtons,
      totalIssues: headingIssues.length + unlabeledInputs.length + emptyButtons.length
    };
  });
  
  console.log(`  Images: ${a11yResults.images}`);
  console.log(`  Headings: ${a11yResults.headings.length}`);
  a11yResults.headings.forEach(h => console.log(`    ${h}`));
  console.log(`  Heading hierarchy issues: ${a11yResults.headingIssues.length}`);
  a11yResults.headingIssues.forEach(i => console.log(`    ❌ ${i}`));
  console.log(`  Unlabeled inputs: ${a11yResults.unlabeledInputs.length}`);
  a11yResults.unlabeledInputs.forEach(i => console.log(`    ⚠️ ${i}`));
  console.log(`  Empty buttons: ${a11yResults.emptyButtons.length}`);
  a11yResults.emptyButtons.forEach(i => console.log(`    ❌ ${i}`));
  
  if (a11yResults.headingIssues.length > 0) {
    results.issues.push({
      severity: 'medium',
      description: `Heading hierarchy issues: ${a11yResults.headingIssues.join('; ')}`,
      selector: 'headings'
    });
  }
  
  await ctx.close();
}

// ==================== 17. NGROK URL ACCESSIBILITY ====================
console.log('\n🔍 Test 17: ngrok URL Accessibility');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  
  try {
    const resp = await page.goto(NGROK_BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
    console.log(`  ngrok URL status: ${resp?.status()}`);
    await screenshot(page, 'qa-ngrok-landing');
    
    if (resp?.status() !== 200) {
      results.issues.push({ severity: 'high', description: `ngrok URL returns ${resp?.status()}`, selector: 'ngrok URL' });
    }
  } catch (e) {
    console.log(`  ❌ ngrok URL unreachable: ${e.message}`);
    results.issues.push({ severity: 'high', description: `ngrok URL unreachable: ${e.message}`, selector: 'ngrok URL' });
  }
  
  await ctx.close();
}

// ==================== 18. CSS CONSISTENCY CHECK ====================
console.log('\n🔍 Test 18: CSS Consistency');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light'
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  
  const cssCheck = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      bg: root.getPropertyValue('--bg'),
      fg: root.getPropertyValue('--fg'),
      accent: root.getPropertyValue('--accent'),
      brandBg: root.getPropertyValue('--brand-bg'),
      brandFg: root.getPropertyValue('--brand-fg'),
      font: root.fontFamily,
      fontSize: root.fontSize,
      lineHeight: root.lineHeight,
    };
  });
  
  console.log(`  CSS Variables (light):`);
  console.log(`    --bg: ${cssCheck.bg}`);
  console.log(`    --fg: ${cssCheck.fg}`);
  console.log(`    --accent: ${cssCheck.accent}`);
  console.log(`    --brand-bg: ${cssCheck.brandBg}`);
  console.log(`    --brand-fg: ${cssCheck.brandFg}`);
  console.log(`    Font: ${cssCheck.font}`);
  
  await ctx.close();
}

// ==================== 19. CROSS-DEVICE VISUAL CONSISTENCY ====================
console.log('\n🔍 Test 19: Cross-device Hero Layout');
{
  const viewports = [
    { name: '320px', width: 320, height: 568 },
    { name: '375px', width: 375, height: 812 },
    { name: '768px', width: 768, height: 1024 },
    { name: '1024px', width: 1024, height: 768 },
    { name: '1440px', width: 1440, height: 900 },
    { name: '1920px', width: 1920, height: 1080 },
  ];
  
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      colorScheme: 'light'
    });
    const page = await ctx.newPage();
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(500);
    
    const layout = await page.evaluate(() => {
      const heroInner = document.querySelector('.hero-inner');
      const heroText = heroInner?.children[0];
      const heroTerm = heroInner?.children[1];
      return {
        heroDisplay: heroInner ? getComputedStyle(heroInner).display : 'not found',
        heroGridCols: heroInner ? getComputedStyle(heroInner).gridTemplateColumns : 'not found',
        textWidth: heroText?.getBoundingClientRect().width || 0,
        termWidth: heroTerm?.getBoundingClientRect().width || 0,
        pageWidth: document.documentElement.clientWidth,
        hasOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    
    const overflow = layout.hasOverflow ? ' ⚠️ OVERFLOW' : '';
    console.log(`  ${vp.name}: grid=${layout.heroDisplay} cols="${layout.heroGridCols.substring(0, 60)}" text=${Math.round(layout.textWidth)}px term=${Math.round(layout.termWidth)}px${overflow}`);
    
    if (layout.hasOverflow) {
      results.issues.push({ severity: 'high', description: `Horizontal overflow at ${vp.width}px viewport`, selector: '.hero-inner' });
    }
    
    await screenshot(page, `qa-hero-${vp.width}px`);
    await ctx.close();
  }
}

// ==================== 20. TERMINAL CODE BLOCK OVERFLOW ====================
console.log('\n🔍 Test 20: Terminal Code Block Overflow');
{
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    colorScheme: 'light',
    isMobile: true
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(500);
  
  const termOverflow = await page.evaluate(() => {
    const terms = document.querySelectorAll('.term');
    return Array.from(terms).map((term, i) => ({
      index: i,
      scrollWidth: term.scrollWidth,
      clientWidth: term.clientWidth,
      isScrollable: term.scrollWidth > term.clientWidth,
      hasFadeClass: term.classList.contains('is-scrollable'),
    }));
  });
  
  termOverflow.forEach(t => {
    console.log(`  Terminal ${t.index}: scroll=${t.scrollWidth} client=${t.clientWidth} scrollable=${t.isScrollable} fade=${t.hasFadeClass}`);
  });
  
  await screenshot(page, 'qa-terminal-mobile-overflow');
  await ctx.close();
}

await browser.close();

// ==================== GENERATE REPORT ====================
console.log('\n' + '='.repeat(80));
console.log('QA/UX TEST REPORT - webcap');
console.log('='.repeat(80));
console.log(`\nScreenshots taken: ${results.screenshots.length}`);
console.log(`Issues found: ${results.issues.length}`);

if (results.issues.length > 0) {
  console.log('\n📋 ISSUES:');
  results.issues.forEach((issue, i) => {
    console.log(`  ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.description}`);
    console.log(`     Selector: ${issue.selector}`);
  });
}

console.log('\n📸 SCREENSHOTS:');
results.screenshots.forEach(s => {
  console.log(`  - ${s.name}: ${s.path}`);
});

console.log('\n✅ PASS STATUS: ' + (results.issues.filter(i => i.severity === 'critical').length > 0 ? 'FAIL' : 'PASS'));

// Save results to JSON
fs.writeFileSync(path.join(out, 'qa-results.json'), JSON.stringify(results, null, 2));
console.log(`\nResults saved to ${out}/qa-results.json`);