# Agent map

Vite + React 19. No router. No server components. Do not add `'use client'`.

`npm run dev` · `npm run lint` · `npm run build`

## Routes

Decided in `src/main.tsx` before render. Not React Router.

- `/` (anything else) → `Catalog`
- Path ending in `/compare`, or hash `#compare` → `Compare`

First paint waits on `ensureTicketFont`. No `StrictMode` (it double-fired SnapDOM atlas captures).

## Trust

- This file is the architecture source. `README.md` only covers how to run and what to click.
- `docs/CANVAS_CACHE_SOLUTIONS.md` and `NOTES-wip-snapdom-tiles.md` are historical. Do not implement from them.
- Do not revive the unused per-ticket bake: `bakeQueue.ts`, `bitmapCache.ts`, `DomCaptureStage.ts`, `captureDomTicket.ts`, `BakeCropClient.ts`. `layout.ts` `CARD_WIDTH` / `CARD_HEIGHT` are stubs.

## What paints

Catalog shows live DOM for the visible rows and canvas for everything scrolled away. The scrollport is the Fortunamania ticket box (`resolveTicketFrame`): desktop 1001×231, and the smaller bands from `GameGrid.module.css`.

- DOM: the near-viewport band, including while scrolling, plus the add gesture and the ball-draw gesture. `computeDomBand` + `DomPool`. Pool size `DOM_POOL_SIZE` (80). Adds under 25 run `playTicketAppear` (Fortunamania 310ms appear) on the last 12 cards, then smooth-scroll to the bottom. Adds of 25 or 100 only scroll. A short row is centered, so adding a ticket slides the others in that row left (`buildSlots`). Draw deals six balls. A ball dabs every ticket that still has it. Rounds 3, 5 and 6 are multiplier draws. The dab, dip, shine and sparkles run on the visible DOM cards (`drawGesture.ts`). After the gesture, tickets shuffle so the highest payout is first (`sortTickets`, 600ms FLIP). After the sixth ball every ticket is gold or green. Scrolled-away tickets update on the canvas at the settled frame.
- Canvas: `CanvasPool` tiles, ~150 tickets each (`canvasTileTickets`; 100 when dpr ≥ 3). Tickets outside the live DOM band are painted when the catalog or the sprites change. The band itself is left blank, so an animating card has no canvas ticket behind it. Scroll only updates those holes. Resize drops the tiles before any repaint. Green-ticket chrome, badges, and id digits are captured in that same warm-up.
- Catalog paint: `paintCatalogTicket` in `catalogPaint.ts` — chrome raster, whole win-amount bitmaps, id digits, and `cellBitmaps`. `paintTicket` in `CanvasPool.ts` is the compare rows.

Sprites come from SnapDOM of real ticket DOM, keyed by layout / font / dpr, RAM + IndexedDB (`atlasStore.ts`):

- Ball numbers → `cellAtlas.ts`
- Header id and win amount → `idDigitAtlas.ts` (whole-string sprites). `fillText` is only the warm-up fallback inside `paintHeaderText`.
- Multiplier badges → `badgeAtlas.ts`. Disc and plain dab share one device-pixel contain rect. The N× label is a SnapDOM sprite shifted onto the live label.
- Live DOM cards → `TicketCard` in `ticketCardElement.ts`

## DPR

One ratio for DOM snap, atlases, and canvas: `activeDpr()` in `cellBoxModel.ts` = `min(devicePixelRatio, DPR_CAP)` with `DPR_CAP = 4`.

- Snap CSS lengths with `snapCss`. Cell boxes: `resolveCellBoxModel` / `getLiveCellBoxModel`.
- Do not read `window.devicePixelRatio` in paint code. Do not add a second cap.
- Backing stores are `Math.round(css * activeDpr())` in `CanvasPool.paintTile` and `Compare`. That is not `device-pixel-content-box`.

Pixel, overlay, blur, hit-test, zoom, or resize work: load `.cursor/skills/canvas-dom-pixels` (`/canvas-dom-pixels`). Log its probe. Do not change buffer sizing or invent a renderer until those numbers are in.

## Compare

`src/catalog/Compare.tsx` stacks one live DOM card and one canvas per fixture (id-only, and dab + multiplier + win). Toolbar: opacity, `difference` blend, nudge, header and badge sprite overlays. Use it to see drift. Do not bake a nudge into source to hide a 1px miss.

The dab fixture has three extra rows under those stacks. The bottom row (`CellBitmapStack`) blits a closed set from `cellBitmaps.ts`: numbers 1–60, one dab, and multipliers 2, 3, 5, and 10. Each bitmap is a `rasterizeTicketSvg` foreignObject of the real cell or badge. The gold face, separators, amount, and ticket id are rasters of that same card, blitted under the cells. That row shows the overlay and, beside it, the same canvas with normal blending. Catalog paint is `paintCatalogTicket`.

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
| `src/catalog/Catalog.tsx` | Scroll catalog |
| `src/catalog/Compare.tsx` | DOM ↔ canvas match view |
| `src/catalog/CanvasPool.ts` | Tiles. Catalog uses `paintCatalogTicket` |
| `src/catalog/catalogPaint.ts` | Catalog ticket blit |
| `src/catalog/headerGlyphs.ts` | Id digits and shared win-amount bitmaps |
| `src/catalog/DomPool.ts` | Viewport DOM cards |
| `src/catalog/bands.ts` | Which slots get DOM |
| `src/catalog/cellBoxModel.ts` | `activeDpr`, `snapCss`, cell boxes |
| `src/catalog/cellAtlas.ts` | Number sprites |
| `src/catalog/cellBitmaps.ts` | 60 numbers + dab + 4 multiplier rasters |
| `src/catalog/ticketSvgRaster.ts` | foreignObject raster of live DOM |
| `src/catalog/idDigitAtlas.ts` | Id / win sprites |
| `src/catalog/badgeAtlas.ts` | Disc images + multiplier label sprites |
| `src/catalog/ticketCardElement.ts` | DOM ticket |
| `src/catalog/ticketPresets.ts` | Size tokens |
| `src/catalog/catalogLayout.ts` | Columns, card size, active layout |
| `src/catalog/layout.ts` | Pool, tile, viewport constants |
| `src/catalog/ticketFont.ts` | MB-Onest gate |
