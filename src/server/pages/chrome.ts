/**
 * The page chrome shared by the landing page and the artifact page: the top
 * bar (brand + nav + theme toggle) and the footer.
 *
 * The theme toggle supports three modes:
 *   1. "system" (default) — follows prefers-color-scheme
 *   2. "dark" — forces dark theme via data-theme="dark" on <html>
 *   3. "light" — forces light theme via data-theme="light" on <html>
 *
 * A small inline <script> at the bottom of the page restores the user's
 * preference from localStorage and applies it before first paint to avoid
 * a flash of the wrong theme (FOUC).
 */

// SVG icons for theme toggle
const SUN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const MOON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

const THEME_SCRIPT = `<script>
(function(){
  var t=localStorage.getItem('theme');
  if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);
  var btn=document.getElementById('theme-toggle');
  if(!btn)return;
  function isDark(){
    if(t==='dark')return true;
    if(t==='light')return false;
    return window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches;
  }
  function updateIcon(){
    var dk=isDark();
    btn.querySelector('.icon-sun').style.display=dk?'none':'block';
    btn.querySelector('.icon-moon').style.display=dk?'block':'none';
    btn.setAttribute('aria-label',dk?'Switch to light theme':'Switch to dark theme');
  }
  function nextMode(){
    var cur=btn.getAttribute('data-current');
    if(cur==='system')return'light';
    if(cur==='light')return'dark';
    return'system';
  }
  var current=t||'system';
  btn.setAttribute('data-current',current);
  updateIcon();
  btn.addEventListener('click',function(){
    var nxt=nextMode();
    btn.setAttribute('data-current',nxt);
    t=nxt==='system'?null:nxt;
    if(nxt==='system'){
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('theme');
    }else{
      document.documentElement.setAttribute('data-theme',nxt);
      localStorage.setItem('theme',nxt);
    }
    updateIcon();
  });
  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',function(){t=btn.getAttribute('data-current')==='system'?null:btn.getAttribute('data-current');updateIcon()});
  }
  // Terminal scroll fade indicator
  document.querySelectorAll('.term').forEach(function(el){
    function check(){
      var s=el.scrollWidth>el.clientWidth;
      el.classList.toggle('is-scrollable',s);
      el.classList.toggle('at-end',s&&el.scrollLeft+el.clientWidth>=el.scrollWidth-4);
    }
    el.addEventListener('scroll',check);
    check();
    new ResizeObserver(check).observe(el);
  });
})();
</script>`;

function topBar(bazaarCatalogUrl: string, currentPage?: string): string {
  const p = currentPage === 'landing' ? '' : '/';
  return `<div class="top"><div class="wrap">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>webcap</a>
  <nav>
    <a href="${p}#features">Features</a>
    <a href="${p}#pricing">Pricing</a>
    <a href="${p}#how">How it works</a>
    <a href="${p}#newsletter">Updates</a>
    <a href="/compare" class="keep">vs alternatives</a>
    <a href="/quickstart" class="keep">quickstart</a>
    <a href="/buy" class="keep">buy credits</a>
    <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Switch to dark theme" data-current="system">
      <span class="icon-sun">${SUN_SVG}</span>
      <span class="icon-moon">${MOON_SVG}</span>
    </button>
    <a href="${p}#preview" class="nav-cta">Try it free</a>
  </nav>
</div></div>${THEME_SCRIPT}`;
}

function footer(bazaarCatalogUrl: string): string {
  return `<footer><div class="wrap"><div class="foot-row">
  <span>webcap \u2014 web capture API. Screenshot, extract, monitor. Pay per call, no accounts.</span>
  <span><a href="/">home</a> \u00B7 <a href="/buy">buy credits</a> \u00B7 <a href="/openapi.json">OpenAPI</a> \u00B7 <a href="${bazaarCatalogUrl}" target="_blank" rel="noopener">Bazaar</a> \u00B7 <a href="/icon.png">icon</a></span>
</div></div></footer>`;
}

export { footer, topBar };
