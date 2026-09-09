/**
 * Record a 30-second demo video of webcap using Playwright.
 *
 * Flow:
 *   1. Landing page hero (value-led messaging)
 *   2. Scroll to "Try it now" form
 *   3. Enter a URL and click Extract
 *   4. Show live preview results
 *   5. Scroll to pricing section
 *
 * Usage:
 *   node scripts/demo-video.mjs
 *
 * Output:
 *   screenshots/demo-<timestamp>.webm
 *
 * Requirements:
 *   - Google Chrome at /usr/bin/google-chrome
 *   - playwright-core (already installed)
 *   - ffmpeg for WebM→MP4 conversion (optional)
 */
import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const BASE = 'http://localhost:8080';
const OUT = '/home/shoutsid/code/webcap/screenshots';
const WIDTH = 1280;
const HEIGHT = 720;
const DURATION_MS = 30_000; // 30 seconds total

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('🎬 Starting webcap demo video recording...');
  console.log(`   Resolution: ${WIDTH}x${HEIGHT}, Duration: ${DURATION_MS / 1000}s`);

  const timestamp = ts();
  const videoDir = path.join(OUT, `demo-${timestamp}`);
  const outputName = `demo-${timestamp}`;

  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    colorScheme: 'light',
    recordVideo: {
      dir: videoDir,
      size: { width: WIDTH, height: HEIGHT },
    },
  });

  const page = await context.newPage();

  try {
    // ── Scene 1: Landing page hero (0–6s) ──
    console.log('  [0-6s] 📸 Landing page hero...');
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500); // Let fonts/animation settle

    // Slow scroll to show the hero section fully
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await page.waitForTimeout(1500);

    // Pause to let viewer read the hero text
    await page.waitForTimeout(3000);

    // ── Scene 2: Scroll to "Try it now" form (6–10s) ──
    console.log('  [6-10s] ⬇️  Scrolling to Try it now form...');
    await page.evaluate(() => {
      const el = document.getElementById('preview');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    await page.waitForTimeout(2000);

    // ── Scene 3: Enter URL and click Extract (10–16s) ──
    console.log('  [10-16s] ✏️  Typing URL and clicking Extract...');
    const input = page.locator('#preview-url-input');
    await input.scrollIntoViewIfNeeded();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.click();
    await input.fill('');
    // Type slowly for visual effect
    await input.type('https://news.ycombinator.com/', { delay: 40 });
    await page.waitForTimeout(500);

    // Click the Extract button
    const btn = page.locator('#preview-btn');
    await btn.click();

    // ── Scene 4: Show preview results loading + results (16–24s) ──
    console.log('  [16-24s] ⏳ Waiting for preview results...');
    await page.waitForTimeout(4000); // Wait for API response

    // Scroll to show results if they appeared
    const results = page.locator('#preview-results');
    if (await results.isVisible().catch(() => false)) {
      await results.scrollIntoViewIfNeeded();
      await page.waitForTimeout(3000);
    } else {
      await page.waitForTimeout(3000);
    }

    // ── Scene 5: Scroll to pricing (24–30s) ──
    console.log('  [24-30s] 📊 Scrolling to pricing section...');
    await page.evaluate(() => {
      const el = document.getElementById('pricing');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    await page.waitForTimeout(4000);

    // Hold on pricing for final frame
    await page.waitForTimeout(2000);

  } catch (err) {
    console.error('❌ Error during recording:', err.message);
  }

  // ── Finalize ──
  await context.close();
  await browser.close();

  console.log('✅ Recording complete!');

  // Find the recorded video file
  const fs = await import('fs');
  const files = fs.readdirSync(videoDir).filter(f => f.endsWith('.webm'));
  if (files.length === 0) {
    console.error('❌ No .webm file found in', videoDir);
    return;
  }

  const webmPath = path.join(videoDir, files[0]);
  const mp4Path = path.join(OUT, `${outputName}.mp4`);

  console.log(`📁 Video: ${webmPath}`);

  // Try to convert to MP4 with ffmpeg
  if (existsSync('/usr/bin/ffmpeg') || existsSync('/usr/local/bin/ffmpeg')) {
    try {
      console.log('🔄 Converting to MP4...');
      execSync(
        `ffmpeg -y -i "${webmPath}" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p "${mp4Path}" 2>/dev/null`,
        { timeout: 60000 }
      );
      console.log(`✅ MP4 saved: ${mp4Path}`);
    } catch (e) {
      console.log(`⚠️  ffmpeg conversion failed, WebM is available at: ${webmPath}`);
    }
  } else {
    console.log('ℹ️  ffmpeg not found. WebM file is at:', webmPath);
    console.log('   Install ffmpeg to convert to MP4: apt install ffmpeg');
  }

  console.log('\n📋 Demo video script complete. Recordings in:', videoDir);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
