/**
 * The verbatim CSS of the public web surfaces. BASE_CSS is the shared design
 * token system (custom properties + component primitives) rendered by BOTH the
 * landing page and the artifact page; LANDING_CSS and ARTIFACT_CSS add the
 * page-specific primitives.
 *
 * Visual language: Light/dark dual-theme via CSS custom properties. Clean,
 * modern design with crisp whites and deep blues. Accent: vibrant blue.
 */

// Shared design tokens + primitives (landing + artifact page render from these)
export const BASE_CSS = `
/* ── Theme: Light (default) ── */
:root{
  --bg:#f8fafc; --panel:#ffffff; --panel-2:#f1f5f9;
  --line:#e2e8f0; --line-soft:#f1f5f9;
  --text:#0f172a; --muted:#475569; --faint:#64748b;
  --accent:#2563eb; --accent-dim:#1d4ed8; --accent-ink:#ffffff;
  --rec:#dc2626; --ok:#16a34a;
  --accent-soft:rgba(37,99,235,.08);
  --code:#334155; --code-link:#2563eb;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px; --s9:96px;
  --r-s:6px; --r-m:10px; --r-l:14px;
  --shadow:0 20px 60px rgba(0,0,0,.08);
  --shadow-card:0 1px 3px rgba(0,0,0,.05),0 4px 16px -4px rgba(0,0,0,.06);
}

/* ── Dark theme: system preference ── */
@media(prefers-color-scheme:dark){:root{
  --bg:#0f172a; --panel:#1e293b; --panel-2:#1e293b;
  --line:#334155; --line-soft:#1e293b;
  --text:#f8fafc; --muted:#94a3b8; --faint:#64748b;
  --accent:#3b82f6; --accent-dim:#2563eb; --accent-ink:#0f172a;
  --rec:#f87171; --ok:#4ade80;
  --accent-soft:rgba(59,130,246,.15);
  --code:#e2e8f0; --code-link:#60a5fa;
  --shadow:0 20px 60px rgba(0,0,0,.4);
  --shadow-card:0 1px 3px rgba(0,0,0,.3),0 4px 16px -4px rgba(0,0,0,.4);
}}

/* ── Dark theme: manual override ── */
html[data-theme="dark"]{
  --bg:#0f172a; --panel:#1e293b; --panel-2:#1e293b;
  --line:#334155; --line-soft:#1e293b;
  --text:#f8fafc; --muted:#94a3b8; --faint:#64748b;
  --accent:#3b82f6; --accent-dim:#2563eb; --accent-ink:#0f172a;
  --rec:#f87171; --ok:#4ade80;
  --accent-soft:rgba(59,130,246,.15);
  --code:#e2e8f0; --code-link:#60a5fa;
  --shadow:0 20px 60px rgba(0,0,0,.4);
  --shadow-card:0 1px 3px rgba(0,0,0,.3),0 4px 16px -4px rgba(0,0,0,.4);
}

/* ── Light theme: manual override ── */
html[data-theme="light"]{
  --bg:#f8fafc; --panel:#ffffff; --panel-2:#f1f5f9;
  --line:#e2e8f0; --line-soft:#f1f5f9;
  --text:#0f172a; --muted:#475569; --faint:#64748b;
  --accent:#2563eb; --accent-dim:#1d4ed8; --accent-ink:#ffffff;
  --rec:#dc2626; --ok:#16a34a;
  --accent-soft:rgba(37,99,235,.08);
  --code:#334155; --code-link:#2563eb;
  --shadow:0 20px 60px rgba(0,0,0,.08);
  --shadow-card:0 1px 3px rgba(0,0,0,.05),0 4px 16px -4px rgba(0,0,0,.06);
}

*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(800px 400px at 50% -150px,var(--accent-soft),transparent 70%)}
main,footer,.top{position:relative;z-index:1}
::selection{background:var(--accent-soft);color:var(--text)}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code{font-family:var(--mono);font-size:.86em;background:rgba(148,163,184,.08);border:1px solid var(--line-soft);border-radius:var(--r-s);padding:1px 6px;white-space:nowrap}
h1,h2,h3{margin:0;line-height:1.15;text-wrap:balance}
h2{font-size:clamp(24px,3.4vw,32px);letter-spacing:-.02em;font-weight:700}
p{margin:0}
.wrap{max-width:1060px;margin:0 auto;padding:0 var(--s5)}
@media(max-width:640px){.wrap{padding:0 var(--s4)}}

/* ── Top bar ── */
.top{position:sticky;top:0;z-index:50;border-bottom:1px solid var(--line-soft);background:rgba(255,255,255,.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
@media(prefers-color-scheme:dark){.top{background:rgba(15,23,42,.8)}}
html[data-theme="dark"] .top{background:rgba(15,23,42,.8)}
html[data-theme="light"] .top{background:rgba(255,255,255,.8)}
.top .wrap{display:flex;justify-content:space-between;align-items:center;gap:var(--s4);padding-top:13px;padding-bottom:13px}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-weight:700;font-size:16px;letter-spacing:-.01em;color:var(--text)}
.brand:hover{text-decoration:none}
.brand-mark{width:22px;height:22px;border-radius:6px;background:var(--text);color:var(--bg);display:grid;place-items:center;flex:none}
.brand-mark::after{content:"";width:9px;height:9px;border-radius:2.5px;background:var(--rec)}
.top nav{display:flex;gap:4px;align-items:center}
.top nav a{font-family:var(--mono);font-size:13px;color:var(--muted);padding:7px 11px;border-radius:8px;border:1px solid transparent;white-space:nowrap}
.top nav a:hover{color:var(--text);text-decoration:none;background:rgba(148,163,184,.08);border-color:var(--line-soft)}
.top nav a.nav-cta{color:var(--accent-ink);background:var(--accent);border-color:var(--accent);font-weight:700}
.top nav a.nav-cta:hover{background:var(--accent);filter:brightness(1.07);color:var(--accent-ink)}
@media(max-width:640px){.top nav a:not(.nav-cta):not(.keep):not(.theme-toggle){display:none}}

/* ── Theme toggle button ── */
.theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;border:1px solid var(--line-soft);background:transparent;color:var(--muted);cursor:pointer;transition:all .15s ease;line-height:1}
.theme-toggle:hover{color:var(--text);background:rgba(148,163,184,.08);border-color:var(--line-soft)}
.theme-toggle svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

/* ── Shared components ── */
.kicker{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);border:1px solid rgba(37,99,235,.15);border-radius:999px;padding:6px 13px}
@media(max-width:640px){.kicker{font-size:10px;letter-spacing:.08em;padding:5px 10px}}
.kicker .rec{color:var(--rec);font-size:9px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--mono);font-size:14px;font-weight:700;padding:12px 24px;border-radius:var(--r-m);background:var(--accent);border:1px solid var(--accent);color:var(--accent-ink);box-shadow:0 1px 2px rgba(0,0,0,.1),0 4px 12px -4px rgba(0,0,0,.1);transition:all .15s ease}
.btn:hover{text-decoration:none;filter:brightness(1.05);transform:translateY(-1px)}
.btn.ghost{background:var(--panel);border-color:var(--line);color:var(--text);box-shadow:none}
.btn.ghost:hover{border-color:var(--accent);background:var(--panel-2)}
.section{padding:var(--s8) 0}
.eyebrow{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:var(--s3)}
.hint{color:var(--muted);max-width:68ch;margin-top:var(--s3);font-size:15px}

/* ── Terminal / code block ── */
.term{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);box-shadow:var(--shadow-card);overflow-x:auto;position:relative;scrollbar-width:thin;scrollbar-color:var(--line) var(--panel-2)}
.term::after{content:"";position:absolute;top:0;right:0;bottom:0;width:40px;background:linear-gradient(to right,transparent,var(--panel));pointer-events:none;border-radius:0 var(--r-l) var(--r-l) 0;opacity:0;transition:opacity .2s}
.term.is-scrollable::after{opacity:1}
.term.is-scrollable.at-end::after{opacity:0}
.term-bar{display:flex;align-items:center;gap:var(--s2);padding:10px var(--s4);border-bottom:1px solid var(--line-soft);background:rgba(148,163,184,.03);font-family:var(--mono);font-size:12px;color:var(--faint);border-radius:var(--r-l) var(--r-l) 0 0;position:sticky;left:0;z-index:1}
.term-bar .fname{margin-left:var(--s2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.term-bar .copy{margin-left:auto;font-size:11px;border:1px solid var(--line);border-radius:6px;padding:2px 8px;color:var(--muted)}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
.term pre{margin:0;padding:18px var(--s4);font-family:var(--mono);font-size:12.5px;line-height:1.7;color:var(--text);white-space:pre}
.term pre code{white-space:pre;background:none;border:none;padding:0}
.hero .term pre{font-size:11px;line-height:1.6;padding:14px var(--s3)}
.term::-webkit-scrollbar{height:6px}
.term::-webkit-scrollbar-track{background:var(--panel-2);border-radius:3px}
.term::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.term::-webkit-scrollbar-thumb:hover{background:var(--muted)}
@media(max-width:640px){.term{font-size:11px}}
.term .c{color:var(--faint)}
.term .k{color:var(--accent)}
.term .s{color:var(--code-link)}
.term .ok{color:var(--ok)}
.term-note{padding:10px var(--s4);border-top:1px solid var(--line-soft);font-family:var(--mono);font-size:12px;color:var(--faint);background:rgba(148,163,184,.03);border-radius:0 0 var(--r-l) var(--r-l)}
.term-note code{font-size:11px}

/* ── Footer ── */
footer{border-top:1px solid var(--line-soft);color:var(--faint);font-size:13.5px}
footer .wrap{padding-top:var(--s6);padding-bottom:var(--s8)}
.foot-row{display:flex;justify-content:space-between;gap:var(--s4);flex-wrap:wrap;align-items:center}
.foot-row a{font-family:var(--mono);font-size:13px;color:var(--muted)}
.foot-row a:hover{color:var(--text)}
`;

// Landing-only primitives
export const LANDING_CSS = `
/* ── Hero ── */
.hero{display:grid;grid-template-columns:1fr;gap:var(--s7);align-items:start;padding:88px 0 56px}
.hero-inner{display:grid;grid-template-columns:1fr 1.1fr;gap:var(--s7);align-items:start}
@media(max-width:880px){.hero{padding:56px 0 48px;gap:var(--s6)}.hero-inner{grid-template-columns:1fr}}
.hero h1{font-size:clamp(36px,5.4vw,56px);letter-spacing:-.03em;font-weight:800;margin-top:20px;line-height:1.04}
.hero h1 .hl{color:var(--accent)}
.lede{color:var(--muted);font-size:clamp(16px,1.8vw,18px);max-width:50ch;margin-top:20px;line-height:1.65}
.lede strong{color:var(--text);font-weight:600}
.cta-row{display:flex;gap:var(--s3);margin-top:28px;flex-wrap:wrap}

/* ── Trust bar (social proof) ── */
.trust-bar{display:grid;grid-template-columns:repeat(5,1fr);gap:var(--s3);padding:var(--s5) 0}
@media(max-width:880px){.trust-bar{grid-template-columns:repeat(3,1fr)}}
@media(max-width:640px){.trust-bar{grid-template-columns:repeat(2,1fr)}}
.trust-item{display:flex;flex-direction:column;align-items:center;gap:4px;padding:var(--s4);background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m);box-shadow:var(--shadow-card);text-align:center}
.trust-num{font-family:var(--mono);font-size:18px;font-weight:800;color:var(--accent);letter-spacing:-.02em}
.trust-label{font-family:var(--mono);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--faint)}

/* ── Social proof (hero inline) ── */
.social-proof{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:13px;color:var(--ok);background:rgba(22,163,74,.06);border:1px solid rgba(22,163,74,.2);border-radius:999px;padding:7px 14px;margin-top:20px;transition:all .3s ease}
.social-proof .proof-icon{font-weight:700}

/* ── Features grid ── */
.features-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s4);margin-top:28px}
@media(max-width:880px){.features-grid{grid-template-columns:1fr;max-width:560px}}
.feature-card{position:relative;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);padding:28px 24px;box-shadow:var(--shadow-card);transition:all .2s ease}
.feature-card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:var(--shadow)}
.feature-card.featured{border-color:var(--accent);background:var(--panel)}
.feature-icon{font-size:32px;margin-bottom:var(--s3)}
.feature-card h3{font-size:18px;font-weight:700;letter-spacing:-.01em;margin-bottom:8px}
.feature-card p{color:var(--muted);font-size:14px;line-height:1.6;flex:1}
.feature-price{font-family:var(--mono);font-size:14px;font-weight:700;color:var(--accent);margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid var(--line-soft)}

/* ── Preview form ── */
.preview-cta{margin-top:24px;background:var(--panel);border:2px solid var(--accent);border-radius:var(--r-l);padding:24px;box-shadow:0 2px 4px rgba(0,0,0,.06),0 8px 24px rgba(37,99,235,.1);position:relative;overflow:hidden}
.preview-cta::before{content:"";position:absolute;top:-1px;left:24px;right:24px;height:3px;background:linear-gradient(90deg,transparent,var(--accent),transparent);border-radius:0 0 4px 4px}
.preview-form{margin-top:0}
.preview-form .url-row{display:flex;gap:10px}
.preview-form .url-row input{flex:1;min-width:0;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-m);color:var(--text);font-family:var(--mono);font-size:14px;padding:11px 14px;transition:border-color .15s ease}
.preview-form .url-row input::placeholder{color:var(--faint)}
.preview-form .url-row input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.preview-form .url-row .btn{min-width:120px;font-weight:700;letter-spacing:.02em}
.preview-form .form-note{color:var(--faint);font-size:13px;margin-top:10px}
.preview-form .form-note a{color:var(--code-link)}
.quick-try{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px}
.quick-try-label{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.quick-try-btn{padding:5px 10px;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-s);font-family:var(--mono);font-size:12px;color:var(--muted);cursor:pointer;transition:all .15s ease;white-space:nowrap}
.quick-try-btn:hover{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
@media(max-width:640px){.preview-form .url-row{flex-direction:column}.preview-form .url-row .btn{width:100%}}
.preview-results{margin-top:16px;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-m);overflow:hidden;transition:all .2s ease}
.preview-results:empty{display:none}
.pr-loading{display:flex;align-items:center;gap:10px;padding:20px;color:var(--muted);font-family:var(--mono);font-size:13px}
.pr-spinner{width:16px;height:16px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.pr-header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line-soft);background:rgba(148,163,184,.03)}
.pr-url{font-family:var(--mono);font-size:14px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr-badge{font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:var(--accent-soft);color:var(--accent);border:1px solid rgba(37,99,235,.3);border-radius:999px;padding:2px 8px;flex:none}
.pr-desc{margin:0;padding:14px 18px;color:var(--muted);font-size:14px;line-height:1.5;border-bottom:1px solid var(--line-soft)}
.pr-section{padding:12px 18px;border-bottom:1px solid var(--line-soft)}
.pr-section:last-of-type{border-bottom:none}
.pr-label{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);margin-bottom:6px;display:block}
.pr-section ul{list-style:none;margin:0;padding:0}
.pr-section li{padding:4px 0;color:var(--text);font-size:14px;line-height:1.5}
.pr-h1,.pr-h2,.pr-h3{font-family:var(--mono);font-size:10px;font-weight:700;border-radius:3px;padding:1px 5px;margin-right:6px}
.pr-h1{background:rgba(37,99,235,.1);color:var(--accent)}
.pr-h2{background:rgba(148,163,184,.1);color:var(--muted)}
.pr-h3{background:rgba(148,163,184,.06);color:var(--faint)}
.pr-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.pr-links a{font-family:var(--mono);font-size:12px;color:var(--code-link);background:rgba(37,99,235,.06);border:1px solid rgba(37,99,235,.15);border-radius:var(--r-s);padding:3px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:border-color .15s ease}
.pr-links a:hover{border-color:var(--code-link);text-decoration:none}
.pr-more{font-family:var(--mono);font-size:12px;color:var(--faint);padding:3px 8px}
.pr-upgrade{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;background:linear-gradient(135deg,var(--accent-soft),rgba(37,99,235,.08));border-top:2px solid var(--accent);font-family:var(--mono);font-size:13px;color:var(--accent-dim);flex-wrap:wrap}
.pr-upgrade-body{flex:1;min-width:200px}
.pr-upgrade-title{font-weight:700;font-size:14px;color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.pr-upgrade-icon{font-size:16px}
.pr-upgrade-features{display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:8px}
.pr-upgrade-feature{font-size:12px;color:var(--text);white-space:nowrap}
.pr-upgrade-steps{display:flex;flex-wrap:wrap;gap:8px 16px;margin-bottom:10px;padding:8px 12px;background:rgba(37,99,235,.06);border-radius:var(--r-s);border:1px solid rgba(37,99,235,.15)}
.pr-upgrade-step{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text);font-weight:500}
.pr-step-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:var(--accent);color:#fff;font-size:11px;font-weight:700;flex-shrink:0}
.pr-upgrade-price{font-size:12px;color:var(--faint);margin-top:4px}
.pr-upgrade a{color:var(--accent);font-weight:600}
.pr-buy-link{background:var(--accent)!important;color:#fff!important;border:2px solid var(--accent)!important;box-shadow:0 4px 16px rgba(37,99,235,.35)!important;font-size:16px!important;padding:14px 32px!important}
.pr-buy-link:hover{transform:translateY(-2px)!important;box-shadow:0 6px 24px rgba(37,99,235,.45)!important}
.pr-upgrade-btn{display:inline-flex;align-items:center;gap:6px;padding:12px 24px;background:var(--accent);color:#fff;border-radius:var(--r-m);font-family:var(--mono);font-size:14px;font-weight:700;text-decoration:none;transition:all .2s ease;white-space:nowrap;box-shadow:0 2px 8px rgba(37,99,235,.25);animation:cta-pulse 2s ease-in-out infinite}
.pr-upgrade-btn:hover{opacity:.9;text-decoration:none;transform:translateY(-2px);box-shadow:0 4px 16px rgba(37,99,235,.4)}
@keyframes cta-pulse{0%,100%{box-shadow:0 2px 8px rgba(37,99,235,.25)}50%{box-shadow:0 2px 16px rgba(37,99,235,.4)}}
.pr-copy-main{display:inline-flex;align-items:center;gap:8px;padding:14px 28px;background:var(--accent);color:#fff;border:none;border-radius:var(--r-m);font-family:var(--mono);font-size:15px;font-weight:700;cursor:pointer;transition:all .2s ease;white-space:nowrap;box-shadow:0 2px 8px rgba(37,99,235,.3);animation:cta-pulse 2s ease-in-out infinite}
.pr-copy-main:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(37,99,235,.4)}
.pr-copy-main:active{transform:translateY(0)}
.pr-demo-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 16px;background:var(--panel);color:var(--accent);border:1px solid var(--accent);border-radius:var(--r-m);font-family:var(--mono);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease;white-space:nowrap;animation:none}
.pr-demo-btn:hover{background:var(--accent-soft);transform:translateY(-1px)}
.pr-upgrade-link{display:inline-flex;align-items:center;gap:4px;padding:10px 16px;color:var(--accent);font-family:var(--mono);font-size:13px;font-weight:600;text-decoration:none;border:1px solid var(--line);border-radius:var(--r-m);background:var(--panel);transition:all .15s ease}
.pr-upgrade-link:hover{border-color:var(--accent);text-decoration:none;background:var(--accent-soft)}
.pr-copy-toast{margin-top:12px;padding:10px 16px;background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.3);border-radius:var(--r-m);color:var(--ok);font-family:var(--mono);font-size:13px;font-weight:600;text-align:center;animation:fadeIn .3s ease}
.pr-copy-toast[hidden]{display:none}
@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.pr-upgrade-top{border-top:none;border-bottom:2px solid var(--accent);margin-bottom:0}
.pr-missing{padding:12px 18px;background:rgba(239,68,68,.04);border-bottom:1px solid var(--line-soft)}
.pr-missing-title{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);display:block;margin-bottom:6px}
.pr-missing-items{display:flex;flex-wrap:wrap;gap:4px 10px}
.pr-missing-item{font-family:var(--mono);font-size:12px;color:#ef4444;white-space:nowrap}
.pr-bottom-actions{display:flex;gap:8px;align-items:center;padding:12px 18px;border-top:1px solid var(--line-soft)}
.pr-upgrade-curl{margin-top:8px;padding:10px 14px;background:rgba(0,0,0,.06);border-radius:var(--r-s);font-family:var(--mono);font-size:12px;color:var(--muted);word-break:break-all}
html[data-theme="dark"] .pr-upgrade-curl,html[data-theme="dark"] .pr-upgrade{background:linear-gradient(135deg,rgba(255,255,255,.04),rgba(37,99,235,.06))}
.pr-upgrade-actions{display:flex;gap:8px;align-items:center;flex-shrink:0}
.pr-copy-btn{padding:10px 16px;background:var(--panel);color:var(--accent);border:1px solid var(--accent);border-radius:var(--r-m);font-family:var(--mono);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease;white-space:nowrap}
.pr-copy-btn:hover{background:var(--accent-soft);transform:translateY(-1px)}
.pr-email-capture{margin-top:16px;padding:16px 20px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-m);text-align:center}
.pr-email-capture p{font-size:13px;color:var(--muted);margin-bottom:8px}
.pr-email-capture .email-note{font-size:11px;color:var(--faint);margin-top:6px;margin-bottom:0}
.pr-try-another{margin-top:12px;padding:12px 20px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pr-try-another .btn-sm{background:var(--panel);color:var(--accent);border:1px solid var(--accent)}
.pr-try-another .btn-sm:hover{background:var(--accent-soft)}
.email-form{display:flex;gap:8px;justify-content:center;max-width:360px;margin:0 auto}
.email-form input{flex:1;padding:8px 12px;border:1px solid var(--line);border-radius:var(--r-s);font-family:var(--mono);font-size:13px;background:var(--bg);color:var(--text)}
.email-form input:focus{border-color:var(--accent);outline:none}
.btn-sm{padding:8px 16px;background:var(--accent);color:var(--accent-ink);border:none;border-radius:var(--r-s);font-family:var(--mono);font-size:13px;font-weight:600;cursor:pointer;transition:all .15s ease;white-space:nowrap}
.btn-sm:hover{filter:brightness(1.07);transform:translateY(-1px)}
.pr-error{padding:16px 18px;color:var(--rec);font-family:var(--mono);font-size:13px;line-height:1.6}
.pr-error strong{color:var(--text);font-weight:600}
.pr-error-icon{font-size:16px;margin-right:4px}
.pr-error-actions{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
.pr-error-link{color:var(--code-link);margin-left:0;display:inline-block}
.pr-retry-btn{padding:6px 12px;background:var(--accent-soft);color:var(--accent);border:1px solid var(--accent);border-radius:var(--r-s);font-family:var(--mono);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s ease}
.pr-retry-btn:hover{background:var(--accent);color:#fff}
.pr-error a{color:var(--code-link);margin-left:4px}
.pr-hint{margin:8px 0 4px;font-family:var(--sans);font-size:13px;color:var(--faint)}

/* ── Pricing grid ── */
.price-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:var(--s4);margin-top:28px}
@media(max-width:880px){.price-grid{grid-template-columns:1fr;max-width:560px}}
.price{position:relative;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);padding:26px 24px;box-shadow:var(--shadow-card);transition:all .2s ease}
.price:hover{border-color:var(--accent);transform:translateY(-3px);box-shadow:var(--shadow)}
.price.featured{border-color:var(--accent);background:var(--panel);box-shadow:var(--shadow)}
.price.featured:hover{border-color:var(--accent)}
.price .flag{position:absolute;top:-11px;left:20px;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:var(--accent);color:var(--accent-ink);border-radius:999px;padding:3px 11px}
.price h3{font-size:12px;font-weight:600;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.12em}
.price .amount{font-size:36px;font-weight:800;letter-spacing:-.03em;margin:12px 0 8px;font-variant-numeric:tabular-nums}
.price .amount small{font-size:13.5px;color:var(--faint);font-weight:500;letter-spacing:0}
.price p{color:var(--muted);font-size:14px;line-height:1.6}
.price p code{white-space:normal;word-break:break-all}
.price .tag{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:12px;color:var(--accent);margin-top:auto;padding-top:16px}
.price .tag::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}

/* ── Steps ── */
.steps{counter-reset:step;list-style:none;margin:28px 0 var(--s4);padding:0;display:grid;gap:var(--s3)}
.steps li{position:relative;padding:20px 20px 20px 68px;background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m);box-shadow:var(--shadow-card)}
.steps li::before{counter-increment:step;content:counter(step);position:absolute;left:20px;top:20px;width:30px;height:30px;display:grid;place-items:center;font-family:var(--mono);font-size:13px;font-weight:700;color:var(--accent);border:1px solid rgba(37,99,235,.3);background:var(--accent-soft);border-radius:50%}
@media(max-width:640px){.steps li{padding:16px 16px 16px 56px}.steps li::before{left:14px;top:16px;width:28px;height:28px;font-size:12px}}
.steps li b{font-size:15.5px;letter-spacing:-.01em}
.steps li p{margin-top:6px;color:var(--muted);font-size:14px;line-height:1.6}
.steps li p code{white-space:normal;word-break:break-all}

/* ── CTA banner ── */
.cta-banner{display:flex;align-items:center;justify-content:space-between;gap:var(--s5);background:var(--panel);border:2px solid var(--accent);border-radius:var(--r-l);padding:32px 36px;box-shadow:var(--shadow-card);position:relative;overflow:hidden}
.cta-banner::before{content:"";position:absolute;top:-1px;left:24px;right:24px;height:3px;background:linear-gradient(90deg,transparent,var(--accent),transparent);border-radius:0 0 4px 4px}
.cta-content h2{font-size:24px;font-weight:800;letter-spacing:-.02em}
.cta-content p{color:var(--muted);font-size:15px;margin-top:6px}
.cta-actions{display:flex;gap:var(--s3);flex-shrink:0}
@media(max-width:640px){.cta-banner{flex-direction:column;text-align:center;padding:24px 20px}.cta-actions{width:100%}.cta-actions .btn{flex:1}}

/* ── Link strip ── */
.link-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--s3)}
.link-strip a{font-family:var(--mono);font-size:13px;border:1px solid var(--line);border-radius:var(--r-m);padding:14px 16px;color:var(--text);display:flex;gap:10px;align-items:center;background:var(--panel);box-shadow:var(--shadow-card);transition:all .15s ease}
.link-strip a:hover{border-color:var(--accent);text-decoration:none;transform:translateY(-1px);box-shadow:var(--shadow)}
.link-strip a .arr{margin-left:auto;color:var(--faint);flex:none}

/* ── Trust strip (badges) ── */
.trust-strip{display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:16px;align-items:center}
.trust-strip a{border:1px solid var(--line-soft);border-radius:var(--r-m);padding:8px 12px;background:var(--panel);display:inline-flex;box-shadow:var(--shadow-card);transition:border-color .15s ease}
.trust-strip a:hover{border-color:var(--accent)}
.trust-strip img{display:block;height:22px;max-width:100%}

/* ── Waitlist form ── */
.waitlist-card{display:flex;align-items:center;justify-content:space-between;gap:var(--s5);background:var(--panel);border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:var(--r-l);padding:28px 32px;box-shadow:var(--shadow-card);position:relative;overflow:hidden}
@media(max-width:640px){.waitlist-card{flex-direction:column;text-align:center;padding:24px 20px}}
.waitlist-content h3{font-size:20px;font-weight:700;letter-spacing:-.01em;margin:0}
.waitlist-content p{color:var(--muted);font-size:14px;margin-top:6px}
.waitlist-form{flex-shrink:0}
.waitlist-row{display:flex;gap:10px}
@media(max-width:640px){.waitlist-row{flex-direction:column;width:100%}.waitlist-row .btn{width:100%}}
.waitlist-row input{flex:1;min-width:0;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-m);color:var(--text);font-family:var(--mono);font-size:14px;padding:11px 14px;transition:border-color .15s ease}
.waitlist-row input::placeholder{color:var(--faint)}
.waitlist-row input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.waitlist-note{font-family:var(--mono);font-size:13px;margin-top:10px}
.waitlist-note.success{color:var(--ok)}
.waitlist-note.error{color:var(--rec)}
`;

// Compare page primitives
export const COMPARE_CSS = `
/* ── Compare page ── */
.compare-main{padding:88px 0 72px;max-width:1060px}
.compare-main h1{font-size:clamp(36px,5.4vw,56px);letter-spacing:-.03em;font-weight:800;margin-top:20px}
.compare-main h1 .hl{color:var(--accent)}
.compare-main .lede{color:var(--muted);font-size:clamp(16px,1.8vw,18px);max-width:58ch;margin-top:20px;line-height:1.65}
@media(max-width:640px){.compare-main{padding:56px 0 48px}}

/* ── Comparison table ── */
.compare-table-wrap{margin-top:40px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);box-shadow:var(--shadow-card);overflow-x:auto}
.compare-table{width:100%;border-collapse:collapse;table-layout:auto;font-size:14px}
.compare-table th,.compare-table td{padding:14px 18px;text-align:left;vertical-align:middle}
.compare-table thead th{font-family:var(--mono);font-size:11.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);background:var(--panel-2);border-bottom:1px solid var(--line-soft);white-space:nowrap}
.compare-table thead th:first-child{border-radius:var(--r-l) 0 0 0}
.compare-table thead th:last-child{border-radius:0 var(--r-l) 0 0}
.compare-table tbody th{font-family:var(--mono);font-size:14px;font-weight:700;color:var(--text)}
.compare-table tbody td{font-family:var(--mono);color:var(--muted)}
.compare-table tbody tr+tr th,.compare-table tbody tr+tr td{border-top:1px solid var(--line-soft)}
.compare-table tbody tr:first-child{background:var(--accent-soft)}
.compare-table tbody tr:first-child th{color:var(--accent)}
.compare-table tbody tr:hover{background:rgba(148,163,184,.03)}
.col-webcap{color:var(--accent)!important;font-weight:600}
@media(max-width:640px){.compare-table{font-size:12.5px}.compare-table th,.compare-table td{padding:10px 12px}}

/* ── Highlight callout ── */
.compare-highlight{margin-top:40px;background:var(--panel);border:2px solid var(--accent);border-radius:var(--r-l);padding:32px 36px;box-shadow:0 2px 4px rgba(0,0,0,.06),0 8px 24px rgba(37,99,235,.1);position:relative;overflow:hidden}
.compare-highlight::before{content:"";position:absolute;top:-1px;left:24px;right:24px;height:3px;background:linear-gradient(90deg,transparent,var(--accent),transparent);border-radius:0 0 4px 4px}
.compare-highlight h3{font-size:22px;font-weight:800;letter-spacing:-.02em}
.compare-highlight p{color:var(--muted);font-size:15px;margin-top:10px;line-height:1.65;max-width:58ch}
.compare-highlight .btn{margin-top:20px}
@media(max-width:640px){.compare-highlight{padding:24px 20px}}

/* ── Sections ── */
.compare-section{padding:var(--s8) 0}
.compare-section h2{margin-bottom:var(--s3)}
.compare-note{color:var(--faint);font-size:13px;margin-top:var(--s6);font-family:var(--mono);line-height:1.6}
`;

// Artifact-page primitives
export const ARTIFACT_CSS = `
.crumb{font-family:var(--mono);font-size:12.5px;color:var(--faint);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.crumb a{color:var(--muted)}
.crumb code{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.artifact-main{padding:40px 0 72px;max-width:1060px}
.artifact-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--s4);flex-wrap:wrap;margin:var(--s3) 0 var(--s5)}
.artifact-main h1{font-size:clamp(20px,3vw,28px);letter-spacing:-.02em;word-break:break-all;margin:0;max-width:100%}
.artifact-actions{display:flex;gap:8px;flex-wrap:wrap}
.artifact-actions a{font-family:var(--mono);font-size:13px;font-weight:600;border:1px solid var(--line);border-radius:var(--r-m);padding:9px 15px;color:var(--text);background:var(--panel);display:inline-flex;align-items:center;gap:8px;white-space:nowrap;box-shadow:var(--shadow-card);transition:all .15s ease}
.artifact-actions a:hover{border-color:var(--accent);text-decoration:none}
.artifact-actions a.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.frame{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);padding:14px;box-shadow:var(--shadow-card)}
.frame img{display:block;width:100%;max-width:100%;height:auto;border-radius:var(--r-m);border:1px solid var(--line-soft)}
.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3);margin:var(--s5) 0}
@media(max-width:640px){.meta{grid-template-columns:1fr}}
.meta div{background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m);padding:14px var(--s4);min-width:0;box-shadow:var(--shadow-card)}
.meta dt{font-family:var(--mono);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--faint)}
.meta dd{margin:6px 0 0;font-family:var(--mono);font-size:14.5px;overflow-wrap:anywhere}
.get{color:var(--muted);font-size:14.5px;margin-bottom:var(--s5);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
`;

// OG-debugger page primitives
export const OG_DEBUGGER_CSS = `
.crumb{font-family:var(--mono);font-size:12.5px;color:var(--faint);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.crumb a{color:var(--muted)}
.debug-main{padding:40px 0 72px;max-width:880px}
.debug-main h1{font-size:clamp(30px,4.6vw,46px);letter-spacing:-.025em;font-weight:800;margin-top:20px}
.debug-main .hint code{white-space:normal;word-break:break-all}
.debug-form{margin-top:28px;background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);padding:22px;box-shadow:var(--shadow-card)}
.debug-form label{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.url-row{display:flex;gap:10px;margin-top:10px}
.url-row input{flex:1;min-width:0;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-m);color:var(--text);font-family:var(--mono);font-size:14px;padding:11px 14px;transition:border-color .15s ease}
.url-row input::placeholder{color:var(--faint)}
.url-row input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
@media(max-width:640px){.url-row{flex-direction:column}.url-row .btn{width:100%}}
.form-note{color:var(--faint);font-size:13px;margin-top:12px}
.form-note code{white-space:normal;word-break:break-all}
.alert{margin-top:var(--s5);border:1px solid rgba(220,38,38,.25);background:rgba(220,38,38,.04);border-radius:var(--r-m);padding:18px 20px}
html[data-theme="dark"] .alert{border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.07)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]) .alert{border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.07)}}
.alert b{font-size:15.5px}
.alert p{margin-top:6px;color:var(--muted);font-size:14px}
.alert p code{white-space:normal;word-break:break-all}
.og-card{display:grid;grid-template-columns:220px 1fr;gap:0;margin-top:var(--s5);background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);overflow:hidden;box-shadow:var(--shadow-card)}
@media(max-width:640px){.og-card{grid-template-columns:1fr}}
.og-media{background:var(--panel-2);border-right:1px solid var(--line-soft);min-height:140px;display:grid;place-items:center;overflow:hidden}
@media(max-width:640px){.og-media{border-right:0;border-bottom:1px solid var(--line-soft);min-height:0}}
.og-media img{display:block;width:100%;height:100%;max-height:240px;object-fit:cover}
.og-ph{font-family:var(--mono);font-size:12px;color:var(--faint);padding:40px 20px}
.og-body{padding:22px 24px;min-width:0}
.og-site{font-family:var(--mono);font-size:12px;color:var(--faint);overflow-wrap:anywhere}
.og-title{font-size:20px;font-weight:700;letter-spacing:-.015em;margin-top:8px;overflow-wrap:anywhere}
.og-desc{color:var(--muted);font-size:14.5px;margin-top:8px;overflow-wrap:anywhere}
.sub-h{font-size:17px;font-weight:650;letter-spacing:-.01em;margin-top:var(--s6);margin-bottom:var(--s3);display:flex;align-items:center;gap:10px}
.sub-h::after{content:"";flex:1;height:1px;background:var(--line-soft)}
.tag-wrap{border:1px solid var(--line);border-radius:var(--r-l);overflow:hidden;background:var(--panel);box-shadow:var(--shadow-card)}
table.og-tags{width:100%;border-collapse:collapse;table-layout:fixed;font-size:14px}
.og-tags th,.og-tags td{text-align:left;padding:12px 16px;vertical-align:top;overflow-wrap:anywhere}
.og-tags thead th{font-family:var(--mono);font-size:11.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint);background:var(--panel-2);border-bottom:1px solid var(--line-soft)}
.og-tags thead th:first-child{width:32%}
.og-tags tbody th{font-family:var(--mono);font-size:13px;font-weight:600;color:var(--accent)}
.og-tags tbody td{font-family:var(--mono);font-size:13px;color:var(--text)}
.og-tags tbody tr+tr th,.og-tags tbody tr+tr td{border-top:1px solid var(--line-soft)}
.cta-band{margin-top:var(--s8);border-top:1px solid var(--line-soft);padding-top:var(--s6)}
.cta-band h2{margin-top:var(--s3)}
.dbg-links{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s3);margin-top:var(--s5)}
@media(max-width:880px){.dbg-links{grid-template-columns:1fr;max-width:560px}}
.dbg-links a{border:1px solid var(--line);border-radius:var(--r-m);padding:16px 18px;color:var(--text);background:var(--panel);display:block;box-shadow:var(--shadow-card);transition:all .15s ease}
.dbg-links a:hover{border-color:var(--accent);text-decoration:none;transform:translateY(-1px);box-shadow:var(--shadow)}
.dbg-links b{display:block;font-family:var(--mono);font-size:13.5px}
.dbg-links span{display:block;color:var(--muted);font-size:13.5px;margin-top:6px}
`;
