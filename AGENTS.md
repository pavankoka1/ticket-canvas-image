# Agent map

Vite + React 19. No router. No server components. Do not add `'use client'`.

`npm run dev` · `npm run lint` · `npm run build`

## Routes

Decided in `src/main.tsx` before render. Not React Router.

- `/` (anything else) → `ticketCatalog` (`mountTicketCatalog`, vanilla)
- Path ending in `/compare`, or hash `#compare` → `Compare`

First paint waits on `ensureTicketFont`. No `StrictMode` (it double-fired SnapDOM atlas captures).

## Trust

- This file is the architecture source. `README.md` only covers how to run and what to click.
- `docs/CANVAS_CACHE_SOLUTIONS.md` and `NOTES-wip-snapdom-tiles.md` are historical. Do not implement from them.
- Do not revive the unused per-ticket bake: `bakeQueue.ts`, `bitmapCache.ts`, `DomCaptureStage.ts`, `captureDomTicket.ts`, `BakeCropClient.ts`. `layout.ts` `CARD_WIDTH` / `CARD_HEIGHT` are stubs.

## What paints

Catalog shows live DOM for the visible rows and canvas for everything scrolled away. The scrollport is the Fortunamania ticket box (`resolveTicketFrame`): desktop 1001×231, and the smaller bands from `GameGrid.module.css`.

- DOM: the near-viewport band, including while scrolling, plus the add gesture and the ball-draw gesture. `computeDomBand` + `DomPool`. Pool size `DOM_POOL_SIZE` (80). Adds under 25 run `playTicketAppear` (Fortunamania 310ms appear) on the last 12 cards, then smooth-scroll to the bottom. Adds of 25 or 100 only scroll. A short row is centered, so adding a ticket slides the others in that row left (`buildSlots`). Draw deals six balls. A ball dabs every ticket that still has it. Rounds 3, 5 and 6 are multiplier draws. The dab, dip, shine and sparkles run on the visible DOM cards (`drawGesture.ts`). After the gesture, tickets shuffle so the highest payout is first (`sortTickets`, 600ms FLIP). After the sixth ball every ticket is gold or green. Scrolled-away tickets update on the canvas at the settled frame.
- Canvas: `CanvasPool` tiles, ~150 tickets each (`canvasTileTickets`; 100 when dpr ≥ 3). Tickets outside the live DOM band are painted when the catalog or ticket state changes. The band itself is left blank on canvas (`skipIds`) so dab/shuffle motion never shows a canvas ticket under DOM. After scroll settles, `syncDom` + `setSkip` repaints tiles whose band membership changed (fill old holes, skip new band). Header glyph X for ticket numbers `1…MAX_TICKETS` is pre-measured at atlas warm. Draw dirties only tiles that contain changed ticket ids. Resize drops the tiles before any repaint.
- **Canvas paint (catalog + compare):** svg-all path via **`paintCatalogTicketSvgAll`** (`catalogSvgPaint.ts`) — warmed compare atlas + cached header glyph X. Legacy sprite blit: **`paintCatalogTicket`** (`catalogPaint.ts`). **North-star for new art:** React native `<svg>` → `renderToStaticMarkup` → self-contained SVG → canvas (`reactSvgRaster.ts`; see https://svg-to-canvas.vercel.app/). **`ticketSvgRaster.ts`** (HTML `foreignObject`) is legacy capture for sprites/headers only, not whole-ticket catalog paint.

## DPR

Display ratio: `activeDpr()` = `round(devicePixelRatio)` capped at `DPR_CAP` (4). **Canvas tickets** — sprite blit at `activeDpr()`. Layout stays integer CSS (`ticketCellGeometry`) for DOM pool vars.

- Snap CSS lengths with `snapCss` where needed. Cell layout: `ticketCellGeometry.ts` — integer CSS `cellW = floor((cardW − 5×sep)/6)`, `left(i)=i×(cellW+sep)`, `top = headerHeight + bodyPaddingY`; `resolveCellBoxModel` mirrors for CSS vars.
- Do not read `window.devicePixelRatio` in paint code. Do not add a second cap.
- Backing stores are `Math.round(css * activeDpr())` in `CanvasPool.paintTile` and `Compare`. That is not `device-pixel-content-box`.

Pixel, overlay, blur, hit-test, zoom, or resize work: load `.cursor/skills/canvas-dom-pixels` (`/canvas-dom-pixels`). Log its probe. Do not change buffer sizing or invent a renderer until those numbers are in.

## Compare

`src/catalog/Compare.tsx` — live DOM + **`paintCatalogTicket`** overlay (`compareSpriteStack.tsx`); React SVG recipe row (`compareReactSvgRecipe.tsx`). Preset dropdown: five `ticketPresets`.

## Skills

Project skills are `.cursor/skills/<name>/SKILL.md`. They are not always-on. Do not add `.cursor/rules`.

- New feature or "how should we build this" → `/frontend-brainstorm`. No code until the user confirms. Alignment topics load `canvas-dom-pixels` instead of a new stack.
- React/TS UI, performance, or a PR → `/frontend-quality`.
- Underspecified intent → global `interview-me` (one question at a time). Do not also run `grill-me` or `grilling` in the same pass.
- A failing or surprising bug → global `debugging-and-error-recovery`. Pixel drift still starts with `canvas-dom-pixels`.
- Motion or easing review → global `review-animations`.
- `typesafe-ai` stays global. Do not copy marketplace skills into this repo.

## Files

| File | Role |
|---|---|
| `src/main.tsx` | Font gate, Catalog vs Compare |
| `src/ticketCatalog/index.ts` | `mountTicketCatalog` entry |
| `src/ticketCatalog/TicketCatalogController.ts` | Home catalog orchestration (no React) |
| `src/ticketCatalog/CanvasPool.ts` | Tiles · svg-all paint |
| `src/ticketCatalog/DomPool.ts` | Viewport DOM cards |
| `src/ticketCatalog/bands.ts` | DOM band |
| `src/catalog/Compare.tsx` | DOM ↔ canvas match view (React) |
| `src/catalog/reactSvgRaster.ts` | React SVG → static markup → canvas cache |
| `src/catalog/compareSpriteStack.tsx` | Compare DOM + sprite canvas |
| `src/catalog/compareReactSvgRecipe.tsx` | Compare badge · tutorial recipe |
