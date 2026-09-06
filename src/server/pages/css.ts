/**
 * The verbatim CSS of the public web surfaces. BASE_CSS is the shared design
 * token system (custom properties + component primitives) rendered by BOTH the
 * landing page and the artifact page; LANDING_CSS and ARTIFACT_CSS add the
 * page-specific primitives. Split out of pages.ts as a pure move (no behavior
 * change) — the served HTML is byte-identical.
 */

// Shared design tokens + primitives (landing + artifact page render from these)
export const BASE_CSS = `
:root{
  --bg:#0a0e17; --panel:#101624; --panel-2:#0d1322;
  --line:#232d44; --line-soft:#182034;
  --text:#eaf0fa; --muted:#94a1b9; --faint:#76839c;
  --accent:#f5b84b; --accent-dim:#8a6a24; --accent-ink:#181205; --rec:#ff6159; --ok:#59d499;
  --code:#c7d2e8; --code-link:#9ecbff;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --s1:4px; --s2:8px; --s3:12px; --s4:16px; --s5:24px; --s6:32px; --s7:48px; --s8:64px; --s9:96px;
  --r-s:6px; --r-m:10px; --r-l:14px;
  --shadow:0 16px 48px rgba(3,6,14,.5);
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);font-size:16px;line-height:1.6}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
code{font-family:var(--mono);font-size:.9em;background:var(--panel-2);border:1px solid var(--line-soft);border-radius:var(--r-s);padding:1px 6px}
h1,h2,h3{margin:0;line-height:1.15}
h2{font-size:clamp(24px,3.4vw,34px);letter-spacing:-.01em}
p{margin:0}
.wrap{max-width:1060px;margin:0 auto;padding:0 var(--s5)}
.top{border-bottom:1px solid var(--line-soft)}
.top .wrap{display:flex;justify-content:space-between;align-items:center;padding-top:var(--s4);padding-bottom:var(--s4)}
.brand{display:flex;align-items:center;gap:var(--s2);font-family:var(--mono);font-weight:700;font-size:18px;color:var(--text)}
.brand:hover{text-decoration:none}
.brand-mark{width:14px;height:14px;border:2px solid var(--accent);border-radius:3px;position:relative;flex:none}
.brand-mark::after{content:"";position:absolute;inset:3px;background:var(--rec);border-radius:1px}
.top nav{display:flex;gap:var(--s4)}
.top nav a{font-family:var(--mono);font-size:13px;color:var(--muted)}
.top nav a:hover{color:var(--text);text-decoration:none}
.kicker{font-family:var(--mono);font-size:12.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
.kicker .rec{color:var(--rec)}
.btn{display:inline-block;font-family:var(--mono);font-size:14px;font-weight:700;padding:10px 18px;border-radius:var(--r-m);background:var(--accent);border:1px solid var(--accent);color:var(--accent-ink)}
.btn:hover{text-decoration:none;filter:brightness(1.06)}
.btn.ghost{background:transparent;border-color:var(--line);color:var(--text)}
.section{padding:var(--s8) 0}
.hint{color:var(--muted);max-width:64ch;margin-top:var(--s3);font-size:15px}
.term{background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-l);box-shadow:var(--shadow);overflow:hidden}
.term-bar{display:flex;align-items:center;gap:var(--s2);padding:10px var(--s4);border-bottom:1px solid var(--line-soft);font-family:var(--mono);font-size:12px;color:var(--faint)}
.dot{width:9px;height:9px;border-radius:50%;flex:none}
.dot.r{background:var(--rec)}.dot.y{background:var(--accent)}.dot.g{background:var(--ok)}
.term pre{margin:0;padding:var(--s4);overflow-x:auto;font-family:var(--mono);font-size:12.5px;line-height:1.65;color:var(--code)}
.term .c{color:var(--faint)}
.term .k{color:var(--accent)}
.term .s{color:var(--code-link)}
.term .ok{color:var(--ok)}
footer{border-top:1px solid var(--line-soft);color:var(--faint);font-size:13.5px}
footer .wrap{padding-top:var(--s6);padding-bottom:var(--s8)}
.foot-row{display:flex;justify-content:space-between;gap:var(--s4);flex-wrap:wrap}
.foot-row a{font-family:var(--mono);font-size:13px}
`;

// Landing-only primitives
export const LANDING_CSS = `
.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:var(--s7);align-items:center;padding:var(--s9) 0 var(--s7)}
@media (max-width:880px){.hero{grid-template-columns:1fr;padding:var(--s8) 0 var(--s6)}}
.hero h1{font-size:clamp(34px,5.4vw,58px);letter-spacing:-.02em;font-weight:800;margin-top:var(--s4)}
.lede{color:var(--muted);font-size:clamp(16px,1.8vw,19px);max-width:54ch;margin-top:var(--s4)}
.cta-row{display:flex;gap:var(--s3);margin-top:var(--s5);flex-wrap:wrap}
.micro{color:var(--faint);font-size:13.5px;margin-top:var(--s4)}
.price-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--s4);margin-top:var(--s5)}
@media (max-width:880px){.price-grid{grid-template-columns:1fr}}
.price{background:var(--panel);border:1px solid var(--line);border-radius:var(--r-l);padding:var(--s5)}
.price h3{font-size:13px;font-family:var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.price .amount{font-size:34px;font-weight:800;letter-spacing:-.02em;margin:var(--s3) 0 var(--s2)}
.price .amount small{font-size:14px;color:var(--faint);font-weight:500}
.price p{color:var(--muted);font-size:14px}
.price .tag{font-family:var(--mono);font-size:12px;color:var(--accent);display:block;margin-top:var(--s3)}
.steps{counter-reset:step;list-style:none;margin:var(--s5) 0 0;padding:0;display:grid;gap:var(--s3)}
.steps li{position:relative;padding:var(--s4) var(--s4) var(--s4) 60px;background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m)}
.steps li::before{counter-increment:step;content:counter(step);position:absolute;left:var(--s4);top:var(--s4);width:28px;height:28px;display:grid;place-items:center;font-family:var(--mono);font-size:13px;color:var(--accent);border:1px solid var(--accent-dim);border-radius:50%}
.steps li p{margin-top:4px;color:var(--muted);font-size:14px}
.sub-h{font-size:18px;margin-top:var(--s6);margin-bottom:var(--s3)}
.link-strip{display:flex;gap:var(--s3);flex-wrap:wrap;margin-top:var(--s5)}
.link-strip a{font-family:var(--mono);font-size:13px;border:1px solid var(--line);border-radius:var(--r-m);padding:10px 14px;color:var(--text);display:inline-flex;gap:8px;align-items:center}
.link-strip a:hover{border-color:var(--accent);text-decoration:none}
.trust-strip{display:flex;gap:var(--s4);flex-wrap:wrap;margin-top:var(--s3);align-items:center}
.trust-strip img{display:block;height:22px}
`;

// Artifact-page primitives
export const ARTIFACT_CSS = `
.crumb{font-family:var(--mono);font-size:12.5px;color:var(--faint)}
.artifact-main{padding:var(--s6) 0 var(--s8)}
.artifact-main h1{font-size:clamp(20px,3vw,28px);word-break:break-all;margin:var(--s3) 0 var(--s5)}
.frame{margin:0;background:var(--panel-2);border:1px solid var(--line);border-radius:var(--r-l);padding:var(--s4);position:relative}
.frame::before{content:"";position:absolute;inset:10px;border:1px solid var(--line);border-radius:var(--r-m);pointer-events:none}
.frame img{display:block;max-width:100%;border-radius:var(--r-m);border:1px solid var(--line-soft);position:relative}
.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s3);margin:var(--s5) 0}
@media (max-width:640px){.meta{grid-template-columns:1fr}}
.meta div{background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r-m);padding:var(--s3) var(--s4)}
.meta dt{font-family:var(--mono);font-size:11.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--faint)}
.meta dd{margin:4px 0 0;font-family:var(--mono);font-size:14.5px}
.get{color:var(--muted);font-size:14.5px;margin-bottom:var(--s5)}
`;
