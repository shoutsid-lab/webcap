/**
 * The verbatim CSS of the public web surfaces. BASE_CSS is the shared design
 * token system (custom properties + component primitives) rendered by BOTH the
 * landing page and the artifact page; LANDING_CSS and ARTIFACT_CSS add the
 * page-specific primitives. Split out of pages.ts as a pure move (no behavior
 * change) — the served HTML is byte-identical.
 *
 * Visual language: Tailwind CSS + shadcn/ui on a dark zinc canvas — neutral
 * surfaces, one restrained amber accent, subtle borders over shadows,
 * radius 8–12px, crisp 13px mono labels. Zero dependencies: all inline.
 */

// Shared design tokens + primitives (landing + artifact page render from these)
export const BASE_CSS = `
:root{
  --bg:#0a0e17; --panel:#111726; --panel-2:#0d1322;
  --line:#263049; --line-soft:#1a2338;
  --text:#f1f5fb; --muted:#a7b2c8; --faint:#9fadc7;
  --accent:#f5b84b; --accent-dim:#8a6a24; --accent-ink:#181205; --rec:#ff6159; --ok:#59d499;
  --accent-soft:rgba(245,184,75,.09);
  --code:#c7d2e8; --code-link:#9ecbff;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px; --s9:96px;
  --r-s:6px; --r-m:10px; --r-l:14px;
  --shadow:0 16px 48px rgba(3,6,14,.5);
  --shadow-card:0 1px 2px rgba(3,6,14,.4),0 8px 28px -12px rgba(3,6,14,.55);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(720px 340px at 50% -120px,rgba(245,184,75,.07),transparent 70%),radial-gradient(900px 420px at 85% -160px,rgba(158,203,255,.05),transparent 70%)}
main,footer,.top{position:relative;z-index:1}
::selection{background:rgba(245,184,75,.28);color:var(--text)}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
code{font-family:var(--mono);font-size:.86em;background:rgba(148,163,184,.1);border:1px solid var(--line-soft);border-radius:var(--r-s);padding:1px 6px;white-space:nowrap}
h1,h2,h3{margin:0;line-height:1.15;text-wrap:balance}
h2{font-size:clamp(24px,3.4vw,32px);letter-spacing:-.02em;font-weight:700}
p{margin:0}
.wrap{max-width:1060px;margin:0 auto;padding:0 var(--s5)}
@media (max-width:640px){.wrap{padding:0 var(--s4)}}
.top{position:sticky;top:0;z-index:50;border-bottom:1px solid var(--line-soft);background:rgba(10,14,23,.82);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.top .wrap{display:flex;justify-content:space-between;align-items:center;gap:var(--s4);padding-top:13px;padding-bottom:13px}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--mono);font-weight:700;font-size:16px;letter-spacing:-.01em;color:var(--text)}
.brand:hover{text-decoration:none}
.brand-mark{width:22px;height:22px;border-radius:6px;background:var(--text);color:#0a0e17;display:grid;place-items:center;flex:none}
.brand-mark::after{content:"";width:9px;height:9px;border-radius:2.5px;background:var(--rec)}
.top nav{display:flex;gap:4px;align-items:center}
.top nav a{font-family:var(--mono);font-size:13px;color:var(--muted);padding:7px 11px;border-radius:8px;border:1px solid transparent;white-space:nowrap}
.top nav a:hover{color:var(--text);text-decoration:none;background:rgba(148,163,184,.08);border-color:var(--line-soft)}
.top nav a.nav-cta{color:var(--accent-ink);background:var(--accent);border-color:var(--accent);font-weight:700}
.top nav a.nav-cta:hover{background:var(--accent);filter:brightness(1.07);color:var(--accent-ink)}
@media (max-width:640px){.top nav a:not(.nav-cta):not(.keep){display:none}}
.kicker{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);border:1px solid rgba(245,184,75,.25);border-radius:999px;padding:6px 13px}
.kicker .rec{color:var(--rec);font-size:9px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--mono);font-size:14px;font-weight:700;padding:11px 20px;border-radius:var(--r-m);background:var(--accent);border:1px solid var(--accent);color:var(--accent-ink);box-shadow:0 1px 2px rgba(3,6,14,.4),0 6px 20px -8px rgba(245,184,75,.45);transition:filter .15s ease,transform .15s ease,border-color .15s ease,background-color .15s ease}
.btn:hover{text-decoration:none;filter:brightness(1.07);transform:translateY(-1px)}
.btn.ghost{background:rgba(148,163,184,.06);border-color:var(--line);color:var(--text);box-shadow:none}
.btn.ghost:hover{border-color:#3b4a6b;background:rgba(148,163,184,.1)}
.section{padding:var(--s8) 0}
.eyebrow{font-family:var(--mono);font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:var(--s3)}
.hint{color:var(--muted);max-width:68ch;margin-top:var(--s3);font-size:15px}
.term{background:#0b111f;border:1px solid var(--line);border-radius:var(--r-l);box-shadow:var(--shadow-card);overflow:hidden;min-width:0}
.term-bar{display:flex;align-items:center;gap:var(--s2);padding:10px var(--s4);border-bottom:1px solid var(--line-soft);background:rgba(148,163,184,.04);font-family:var(--mono);font-size:12px;color:var(--faint)}
.term-bar .fname{margin-left:var(--s2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.term-bar .copy{margin-left:auto;font-size:11px;border:1px solid var(--line);border-radius:6px;padding:2px 8px;color:var(--muted)}
.dot{width:10px;height:10px;border-radius:50%;flex:none}
.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
.term pre{margin:0;padding:18px var(--s4);overflow-x:auto;font-family:var(--mono);font-size:12.5px;line-height:1.7;color:var(--code)}
.term pre::-webkit-scrollbar,.term pre{scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.term .c{color:#6b7a94}
.term .k{color:var(--accent)}
.term .s{color:var(--code-link)}
.term .ok{color:var(--ok)}
footer{border-top:1px solid var(--line-soft);color:var(--faint);font-size:13.5px;background:rgba(13,19,34,.5)}
footer .wrap{padding-top:var(--s6);padding-bottom:var(--s8)}
.foot-row{display:flex;justify-content:space-between;gap:var(--s4);flex-wrap:wrap;align-items:center}
.foot-row a{font-family:var(--mono);font-size:13px;color:var(--muted)}
.foot-row a:hover{color:var(--text)}
`;

// Landing-only primitives
export const LANDING_CSS = `
.hero{display:grid;grid-template-columns:1.02fr .98fr;gap:var(--s7);align-items:center;padding:88px 0 72px}
@media (max-width:880px){.hero{grid-template-columns:1fr;padding:56px 0 48px;gap:var(--s6)}}
.hero h1{font-size:clamp(36px,5.4vw,58px);letter-spacing:-.03em;font-weight:800;margin-top:20px;line-height:1.04}
.hero h1 .hl{color:var(--accent)}
.lede{color:var(--muted);font-size:clamp(16px,1.8vw,18px);max-width:56ch;margin-top:20px;line-height:1.65}
.lede strong{color:var(--text);font-weight:600}
.cta-row{display:flex;gap:var(--s3);margin-top:28px;flex-wrap:wrap}
.micro{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--faint);font-size:13.5px;margin-top:20px;background:rgba(148,163,184,.05);border:1px solid var(--line-soft);border-radius:var(--r-m);padding:10px 14px;max-width:max-content}
.micro a{color:var(--code-link)}
.micro code{white-space:nowrap}
@media (max-width:640px){.micro{max-width:100}.micro code{white-space:normal;word-break:break-all}}
.hero-badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:20px}
.hero-badges span{font-family:var(--mono);font-size:12px;color:var(--muted);border:1px solid var(--line-soft);background:rgba(148,163,184,.05);border-radius:999px;padding:5px 12px}
.sec-head{max-width:72ch}
.price-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s4);margin-top:28px}
@media (max-width:880px){.price-grid{grid-template-columns:1fr;max-width:560px}}
.price{position:relative;display:flex;flex-direction:column;background:linear-gradient(180deg,rgba(148,163,184,.06),rgba(148,163,184,.015) 38%),var(--panel);border:1px solid var(--line);border-radius:var(--r-l);padding:26px 24px;box-shadow:var(--shadow-card);transition:border-color .15s ease,transform .15s ease}
.price:hover{border-color:#3b4a6b;transform:translateY(-2px)}
.price.featured{border-color:rgba(245,184,75,.45);background:linear-gradient(180deg,rgba(245,184,75,.08),rgba(245,184,75,.015) 42%),var(--panel)}
.price.featured:hover{border-color:rgba(245,184,75,.65)}
.price .flag{position:absolute;top:-11px;left:20px;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:var(--accent);color:var(--accent-ink);border-radius:999px;padding:3px 11px}
.price h3{font-size:12px;font-weight:600;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.12em}
.price .amount{font-size:36px;font-weight:800;letter-spacing:-.03em;margin:12px 0 8px;font-variant-numeric:tabular-nums}
.price .amount small{font-size:13.5px;color:var(--faint);font-weight:500;letter-spacing:0}
.price p{color:var(--muted);font-size:14px;line-height:1.6}
.price p code{white-space:normal;word-break:break-all}
.price .tag{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:12px;color:var(--accent);margin-top:auto;padding-top:16px}
.price .tag::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}
.steps{counter-reset:step;list-style:none;margin:28px 0 0;padding:0;display:grid;gap:var(--s3)}
.steps li{position:relative;padding:20px 20px 20px 68px;background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m)}
.steps li::before{counter-increment:step;content:counter(step);position:absolute;left:20px;top:20px;width:30px;height:30px;display:grid;place-items:center;font-family:var(--mono);font-size:13px;font-weight:700;color:var(--accent);border:1px solid rgba(245,184,75,.4);background:var(--accent-soft);border-radius:50%}
.steps li b{font-size:15.5px;letter-spacing:-.01em}
.steps li p{margin-top:6px;color:var(--muted);font-size:14px;line-height:1.6}
.steps li p code{white-space:normal;word-break:break-all}
.sub-h{font-size:17px;font-weight:650;letter-spacing:-.01em;margin-top:var(--s6);margin-bottom:var(--s3);display:flex;align-items:center;gap:10px}
.sub-h::after{content:"";flex:1;height:1px;background:var(--line-soft)}
.link-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--s3);margin-top:28px}
.link-strip a{font-family:var(--mono);font-size:13px;border:1px solid var(--line);border-radius:var(--r-m);padding:14px 16px;color:var(--text);display:flex;gap:10px;align-items:center;background:var(--panel);transition:border-color .15s ease,transform .15s ease}
.link-strip a:hover{border-color:rgba(245,184,75,.5);text-decoration:none;transform:translateY(-1px)}
.link-strip a .arr{margin-left:auto;color:var(--faint);flex:none}
.trust-strip{display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:16px;align-items:center}
.trust-strip a{border:1px solid var(--line-soft);border-radius:var(--r-m);padding:8px 12px;background:var(--panel);display:inline-flex;transition:border-color .15s ease}
.trust-strip a:hover{border-color:#3b4a6b}
.trust-strip img{display:block;height:22px;max-width:100%}
.divider{border:0;border-top:1px solid var(--line-soft);margin:0}
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
.artifact-actions a{font-family:var(--mono);font-size:13px;font-weight:600;border:1px solid var(--line);border-radius:var(--r-m);padding:9px 15px;color:var(--text);background:var(--panel);display:inline-flex;align-items:center;gap:8px;white-space:nowrap}
.artifact-actions a:hover{border-color:rgba(245,184,75,.5);text-decoration:none}
.artifact-actions a.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.frame{margin:0;background:#0b111f;border:1px solid var(--line);border-radius:var(--r-l);padding:14px;box-shadow:var(--shadow-card)}
.frame img{display:block;width:100%;max-width:100%;height:auto;border-radius:var(--r-m);border:1px solid var(--line-soft)}
.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3);margin:var(--s5) 0}
@media (max-width:640px){.meta{grid-template-columns:1fr}}
.meta div{background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m);padding:14px var(--s4);min-width:0}
.meta dt{font-family:var(--mono);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--faint)}
.meta dd{margin:6px 0 0;font-family:var(--mono);font-size:14.5px;overflow-wrap:anywhere}
.get{color:var(--muted);font-size:14.5px;margin-bottom:var(--s5);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
`;
