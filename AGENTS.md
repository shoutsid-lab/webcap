# Webcap Development Guide

## Project Structure
- `src/server/pages/` - HTML page generators (TypeScript)
  - `css.ts` - All CSS styles with light/dark theme support
  - `chrome.ts` - Top bar, footer, theme toggle, scroll detection
  - `landing.ts` - Landing page
  - `og-debugger.ts` - OG debugger tool
  - `format.ts` - Text helpers
  - `copy.ts` - Chain-conditional copy
- `src/server/pages.ts` - Artifact page + re-exports

## Theme System
- Light theme defined in `:root` (default)
- Dark theme via `@media(prefers-color-scheme:dark)` for system preference
- Manual override via `html[data-theme="dark"]` and `html[data-theme="light"]`
- Theme toggle button in nav bar persists to localStorage
- Scroll fade indicator on terminal blocks (`.term.is-scrollable::after`)

## Rebuild & Deploy (Docker)
```bash
# 1. Build TypeScript
npm run build

# 2. Rebuild Docker image
docker compose build webcap

# 3. Restart container
docker compose up -d webcap

# 4. Verify
curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/
```

## Take Screenshots
```bash
node screenshots/screenshot.mjs
```
- Saves to `screenshots/` directory
- Captures light/dark themes for desktop and mobile
- Requires Google Chrome at `/usr/bin/google-chrome`

## Environment Variables
Key ones from `.env`:
- `WEBCAP_PUBLIC_BASE_URL` - Public URL for artifacts
- `WEBCAP_CHAIN` - Network (base, base-sepolia, local)
- `WEBCAP_PORT` - Server port (default 8080)

## Tests
```bash
npm test           # Run all tests
npm run typecheck  # Type checking only
```
- WCAG contrast test validates `--faint` has >= 4.5:1 contrast against `--bg`

## CSS Architecture
- `BASE_CSS` - Shared design tokens + primitives (top bar, footer, buttons, terminal)
- `LANDING_CSS` - Landing-specific (hero grid, pricing cards, steps, links)
- `ARTIFACT_CSS` - Artifact page (breadcrumb, meta grid, frame)
- `OG_DEBUGGER_CSS` - OG debugger (form, preview card, tag table)

## Key Design Decisions
1. **Hero layout**: Uses `.hero-inner` grid (text left, terminal right)
2. **Code blocks**: `overflow-x:auto` on `.term`, fade indicator via `::after` pseudo-element
3. **Theme toggle**: SVG icons (sun/moon), not emoji, for consistent rendering
4. **Mobile**: Kicker badge shrinks, steps list adjusts padding, code font reduces
