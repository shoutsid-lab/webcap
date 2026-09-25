/**
 * GET /feedback — the human feedback page.
 *
 * The machine route POST /v1/feedback is the primary channel (that is what an
 * autonomous agent calls, with no account and no human round-trip; see
 * src/server/feedback-routes.ts). This page is the thin human counterpart: a
 * plain HTML form posting application/x-www-form-urlencoded to the same
 * route. It is deliberately simple — no JavaScript, no auth, a short form and
 * a server-rendered confirmation — because a feedback form that demands
 * accounts or installs a client-side bundle is exactly the friction the
 * agent-first charter forbids introducing elsewhere.
 *
 * The submitted values are esc()-escaped. `/feedback` (page) and
 * `/v1/feedback` (JSON route) are kept distinct on purpose: the page is a
 * human surface (it appears on the human top bar as a nav link), and the JSON
 * route is the machine one; the page holds no SELECT and no state of its own.
 */
import { DEFAULT_BAZAAR_CATALOG_URL, type WebcapConfig } from '../../config.js';
import { esc } from './format.js';
import { footer, topBar } from './chrome.js';
import { BASE_CSS, ARTIFACT_CSS } from './css.js';

const CATEGORIES = ['bug', 'suggestion', 'pricing', 'docs', 'integration', 'other'];

/** A single rendered outcome: empty form, confirmed, or rejected. */
export type FeedbackPageData =
  | { readonly state: 'empty' }
  | { readonly state: 'ok'; readonly id: number }
  | { readonly state: 'rejected'; readonly message: string };

function categoryOptions(selected?: string): string {
  return CATEGORIES.map((c) => {
    const sel = c === selected ? ' selected' : '';
    return `      <option value="${c}"${sel}>${esc(c)}</option>`;
  }).join('\n');
}

function resultBand(data: FeedbackPageData): string {
  if (data.state === 'ok') {
    return `<div class="fb-ok" role="status"><b>Thanks — received.</b>
      <p>Your note is stored (id <code>${esc(String(data.id))}</code>) and read by the operator. Agents can do the same in one JSON request: <code>POST /v1/feedback</code>.</p>
      <p class="fb-note"><a href="/feedback">Send another</a> · <a href="/">back to webcap</a></p></div>`;
  }
  if (data.state === 'rejected') {
    return `<div class="fb-err" role="alert"><b>Not sent.</b>
      <p>${esc(data.message)}</p>
      <p class="fb-note"><a href="/feedback">Try again</a></p></div>`;
  }
  return '';
}

export function feedbackHtml(config: WebcapConfig, data: FeedbackPageData): string {
  const bazaarCatalogUrl = config.bazaarCatalogUrl ?? DEFAULT_BAZAAR_CATALOG_URL;
  const band = resultBand(data);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feedback — webcap</title>
<meta name="description" content="Send webcap a note: report a bug, ask for a feature, pricing, or docs. One short form, no account needed. Agents use POST /v1/feedback.">
<link rel="icon" href="/icon.png">
<style>${BASE_CSS}${ARTIFACT_CSS}
.fb-wrap{max-width:640px;margin:0 auto;padding:48px 0 72px}
.fb-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);box-shadow:var(--shadow-card);padding:28px}
.fb-card h1{font-size:26px;letter-spacing:-.02em;font-weight:800;margin:0 0 6px}
.fb-card .lede{color:var(--muted);font-size:15px;margin:0 0 22px}
.fb-card label{display:block;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:14px 0 6px}
.fb-card input[type=text],.fb-card select,.fb-card textarea{width:100%;box-sizing:border-box;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-m);color:var(--text);font-family:var(--mono);font-size:14px;padding:11px 14px}
.fb-card select{cursor:pointer}
.fb-card textarea{min-height:150px;resize:vertical;font-family:var(--sans)}
.fb-card input:focus,.fb-card select:focus,.fb-card textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.fb-btn{margin-top:18px}
.fb-ok,.fb-err{margin-top:18px;padding:16px;border-radius:var(--r-m);font-size:14px}
.fb-ok{background:rgba(22,163,74,.07);border:1px solid rgba(22,163,74,.25)}
.fb-ok b{color:var(--ok)}
.fb-err{background:rgba(220,38,38,.06);border:1px solid rgba(220,38,38,.25)}
.fb-err b{color:var(--rec)}
.fb-note{margin-top:10px;color:var(--muted);font-size:13px}
.fb-note a{color:var(--code-link)}
.fb-meta{margin-top:6px;color:var(--faint);font-size:12px}
</style>
</head>
<body>
${topBar(bazaarCatalogUrl)}
<main class="wrap fb-wrap">
  <div class="fb-card">
    <h1>Feedback</h1>
    <p class="lede">Something to say about webcap? One short form, no account. Agents: use <code>POST /v1/feedback</code> — the same channel, JSON in.</p>
    <form method="post" action="/v1/feedback">
      <label for="fb-category">Category</label>
      <select id="fb-category" name="category">
${categoryOptions()}
      </select>
      <label for="fb-message">Your feedback</label>
      <textarea id="fb-message" name="message" maxlength="4000" required placeholder="What happened? / What would you change? (8+ characters)"></textarea>
      <button class="btn fb-btn" type="submit">Send feedback</button>
    </form>
    ${band}
    <p class="fb-meta">Rate-limited per client (60/hr). No account, no email, no CAPTCHA.</p>
  </div>
</main>
${footer(bazaarCatalogUrl)}
</body>
</html>`;
}
