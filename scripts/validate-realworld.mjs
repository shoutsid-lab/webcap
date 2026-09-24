/**
 * Real-world validation battery (plain Node, runs against dist/ = what prod
 * runs). Usage: npm run build && node scripts/validate-realworld.mjs
 */
import { capture, captureStructured } from '../dist/capture/pipeline.js';
import { closeBrowser } from '../dist/capture/browser.js';
import { validateCaptureUrl } from '../dist/util/url.js';

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

function pngDims(buf) {
  if (buf.length < 33 || buf[12] !== 0x49) return 'not-png';
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

async function main() {
  try {
    const r = await capture({ url: 'https://example.com/' });
    check('baseline example.com', r.format === 'png' && r.bytes > 1000, `${r.format} ${r.bytes}b ${pngDims(r.buffer)}`);
  } catch (err) {
    check('baseline example.com', false, String(err).slice(0, 160));
  }

  try {
    const r = await capture({
      url: 'https://example.com/',
      options: { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 },
    });
    check('mobile viewport', pngDims(r.buffer).startsWith('780x'), `${pngDims(r.buffer)} (expect 780x… @2x)`);
  } catch (err) {
    check('mobile viewport', false, String(err).slice(0, 160));
  }

  for (const stealth of [false, true]) {
    try {
      const r = await capture({
        url: 'https://github.com/',
        options: { timeoutMs: 25000, ...(stealth ? { stealth: true } : {}) },
      });
      check(`github.com stealth=${stealth}`, r.bytes > 5000, `${r.bytes}b ${pngDims(r.buffer)}`);
    } catch (err) {
      check(`github.com stealth=${stealth}`, false, String(err).slice(0, 160));
    }
  }

  const bannerUrl = 'https://www.theguardian.com/';
  try {
    const before = await captureStructured({ url: bannerUrl, options: { timeoutMs: 25000 } });
    const beforeHit = /cookie|consent/i.test(before.structure.markdown.slice(0, 2000));
    // Agent workflow: find the consent-accept control in the raw HTML, then click it.
    const probe = await captureStructured({ url: bannerUrl, options: { includeHtml: true, timeoutMs: 25000 } });
    const m = probe.html.match(/id="([^"]*(?:onetrust-accept|accept[^"]*cookies|consent-accept)[^"]*)"/i)
      || probe.html.match(/data-testid="([^"]*(?:accept|consent)[^"]*)"/i);
    if (m === null) {
      check('banner dismiss via actions', !beforeHit, `no accept control found; banner-in-text=${beforeHit}`);
    } else {
      const sel = m[0].startsWith('data-testid') ? `[data-testid="${m[1]}"]` : `#${m[1]}`;
      const after = await captureStructured({
        url: bannerUrl,
        options: { timeoutMs: 25000, actions: [{ type: 'click', selector: sel }] },
      });
      const afterHit = /cookie|consent/i.test(after.structure.markdown.slice(0, 2000));
      check('banner dismiss via actions', beforeHit && !afterHit, `clicked ${sel}; banner-before=${beforeHit} banner-after=${afterHit}`);
    }
  } catch (err) {
    check('banner dismiss via actions', false, String(err).slice(0, 200));
  }

  try {
    const r = await captureStructured({ url: 'https://httpbin.org/html' });
    const okTitle = r.structure.title === 'Herman Melville - Moby-Dick';
    check(
      'extract structure httpbin',
      okTitle && r.structure.wordCount > 100 && r.structure.markdown.length > 0,
      `title=${JSON.stringify(r.structure.title)} words=${r.structure.wordCount}`,
    );
  } catch (err) {
    check('extract structure httpbin', false, String(err).slice(0, 160));
  }

  try {
    const r = await captureStructured({
      url: 'https://httpbin.org/cookies',
      options: { cookies: [{ name: 'session', value: 'test-123' }] },
    });
    const echo = r.structure.markdown.includes('test-123') || JSON.stringify(r.structure.paragraphs).includes('test-123');
    check('auth cookie sent', echo, echo ? 'cookie echoed by server' : `no echo; paras=${JSON.stringify(r.structure.paragraphs).slice(0, 120)}`);
  } catch (err) {
    check('auth cookie sent', false, String(err).slice(0, 200));
  }

  try {
    const r = await captureStructured({
      url: 'https://httpbin.org/headers',
      options: { extraHTTPHeaders: { authorization: 'Bearer probe-token' } },
    });
    const echo = r.structure.markdown.includes('probe-token');
    check('auth header sent', echo, echo ? 'header echoed by server (in markdown)' : 'no echo');
  } catch (err) {
    check('auth header sent', false, String(err).slice(0, 160));
  }

  for (const bad of ['http://localhost/admin', 'http://169.254.169.254/', 'not-a-url', 'file:///etc/passwd']) {
    try {
      validateCaptureUrl(bad, { allowHosts: undefined });
      check(`reject ${bad}`, false, 'accepted (should have thrown)');
    } catch {
      check(`reject ${bad}`, true, 'threw as expected');
    }
  }

  await closeBrowser();
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
