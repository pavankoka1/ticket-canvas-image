# Agent map

Vite + React 19. No router. No server components. Do not add `'use client'`.

`npm run dev` · `npm run lint` · `npm run build`

## Routes

Decided in `src/main.tsx` before render. Not React Router.

- `/` (anything else) → `ticketCatalog` (`mountTicketCatalog`, vanilla)
- Path ending in `/compare`, or hash `#compare` → `Compare`

First paint waits on `ensureTicketFont`. No `StrictMode` (it double-fired SnapDOM atlas captures).

Warm / resize timing (compare with FM): filter console on `[catalog-warm]`, `[catalog-resize]`, and `[atlas-warm]` (compare pack captures + `skipIdb`).

## Trust

- This file is the architecture source. `README.md` only covers how to run and what to click.
- `docs/CANVAS_CACHE_SOLUTIONS.md` and `NOTES-wip-snapdom-tiles.md` are historical. Do not implement from them.
- Do not revive the unused per-ticket bake under `ticketCatalog/_legacy/` (`bakeQueue.ts`, `bitmapCache.ts`, `DomCaptureStage.ts`, `captureDomTicket.ts`, `BakeCropClient.ts`). `constants.ts` `CARD_WIDTH` / `CARD_HEIGHT` are stubs.

## What paints

Catalog shows live DOM for the visible rows and canvas for everything scrolled away. The scrollport is the Fortunamania ticket box (`resolveTicketFrame`): desktop 1001×231, and the smaller bands from `GameGrid.module.css`. Portrait phone bands are FM's plus two rows (POC choice; FM 160/119/104 → 242/201/176).

- DOM: the near-viewport band, including while scrolling, plus the add gesture and the ball-draw gesture. `computeDomBand` + `DomPool`. Pool size `DOM_POOL_SIZE` (80). Adds under 25 run `playTicketAppear` (Fortunamania 310ms appear) on the last 12 cards, then smooth-scroll to the bottom. Adds of 25 or 100 only scroll. A short row is centered; on add the others in that row snap to their new slot, like Fortunamania's flex reflow (`buildSlots`). Reset is instant. Draw deals six balls. A ball dabs every ticket that still has it. Rounds 3, 5 and 6 are multiplier draws. The dab, dip, shine and sparkles run on the visible DOM cards (`drawGesture.ts`, timings in `drawPhase.ts`). After the gesture, and only when the catalog is scrolled to the top, tickets shuffle so the highest payout is first (`sortTickets`, `resolveShufflePlan`). The FLIP starts after the draw settles (600, 1500 or 1560ms) and lasts 600ms, the same for every card, eased with `EASE_IN_OUT_CUBIC`. Card position lives on the CSS `translate` property (FLIP and appear use `TicketCard.startMove`); the draw dip animates `scale`, so a shuffle never cancels a running dab, bounce or shine. Off-screen FLIP endpoints are clamped to just past the viewport edge (`DomPool.playMoves`). Sparkle spots and the multiplier settle come from `resolveTicketSparklePlan` (measured anchors, 300ms, 150ms stagger). After the sixth ball's gesture and shuffle settle, every ticket is gold or green (`endRound`). Scrolled-away tickets update on the canvas at the settled frame.
- Canvas: `CanvasPool` tiles, 70 tickets each (`canvasTileTickets`; 20 when dpr ≥ 3). **Every ticket is painted on canvas** except ids in the live DOM band (`skipIds` / `punchSkipHoles` — transparent cells so DOM covers them; no double stack). Async `flushDirtyTiles` walks **all** tiles (`needsPaint`: dirty or no backing store yet), not viewport-only lazy allocation. Over `CANVAS_TILE_RETAIN_BYTES` (48MB) coldest off-screen tiles may still release backing stores and repaint on the next flush (iOS Safari budget). **While scrolling:** compositor only — `holdRetainBudgetForScroll` pauses eviction; async tile paint stays paused. **On scroll settle:** `syncDom` rebinds the ~80-card band, `resumeWithBand` updates `skipIds` and flushes holes / deltas (`flushDirtyTilesInViewportSync` then async catalog flush). Bulk add awaits `flushEntireCatalog` before smooth scroll. Programmatic scroll uses `primeViewport` at the destination. Tickets outside the live DOM band are always canvas-painted when tiles flush. Header glyph X for ticket numbers `1…MAX_TICKETS` is pre-measured at atlas warm in batches (`measureHeaderGlyphDeviceXsBatch`, cloned `<text>` on one measure card; no per-ticket bind). Draw dirties only tiles that contain changed ticket ids. Resize drops the tiles before any repaint. Overlay/capture code reads geometry from `layoutForCard(root)`, never `getActiveLayout()`: rotation prewarm captures the other orientation's cards while the live layout is still active (`prepareCompareCard` registers them).
- **Canvas paint (catalog + compare):** svg-all path via **`paintCatalogTicketSvgAll`** (`catalogSvgPaint.ts`) — warmed compare atlas + cached header glyph X. Legacy sprite blit: **`paintCatalogTicket`** (`catalogPaint.ts`). **North-star for new art:** React native `<svg>` → `renderToStaticMarkup` → self-contained SVG → canvas (`reactSvgRaster.ts`; see https://svg-to-canvas.vercel.app/). **`ticketSvgRaster.ts`** (HTML `foreignObject`) is legacy capture for sprites/headers only, not whole-ticket catalog paint.

## DPR

Display ratio: `activeDpr()` = `round(devicePixelRatio)` capped at `DPR_CAP` (4). **Canvas tickets** — sprite blit at `activeDpr()`. Layout stays integer CSS (`ticketCellGeometry`) for DOM pool vars.

- Snap CSS lengths with `snapCss` where needed. Cell layout: `ticketCellGeometry.ts` — integer CSS `cellW = floor((cardW − 5×sep)/6)`, `left(i)=i×(cellW+sep)`, `top = headerHeight + bodyPaddingY`; `resolveCellBoxModel` mirrors for CSS vars.
- Do not read `window.devicePixelRatio` in paint code. Do not add a second cap.
- Backing stores are `Math.round(css * activeDpr())` in `CanvasPool.paintTile` and `Compare`. That is not `device-pixel-content-box`.
- Origins (`catalogOriginSnap.ts`): `snapCatalogFrameOrigin` nudges `.catalogFrame` by layout `left`/`top` so the lane starts on a whole CSS px (re-run on toolbar resize; ⅓ px is not exact in Blink layout units). Card slots use `snapLayoutOrigin`: whole CSS px on WebKit, device grid elsewhere. Never fix drift with a transform on the lane or cards (iPhone S7/S8).
- Overlay text baselines (header, numbers, multiplier) come from `resolveTicketTextBaselines`: a hidden copy of FM `Ticket.module.css` measured at runtime, snapped like HTML text (Blink: whole CSS px, WebKit: device px). No em constants. The values are part of the compare pack key.

Pixel, overlay, blur, hit-test, zoom, or resize work: load `.cursor/skills/canvas-dom-pixels` (`/canvas-dom-pixels`). Log its probe. Do not change buffer sizing or invent a renderer until those numbers are in.

## Compare

`src/catalog/Compare.tsx` — live DOM + **`paintCatalogTicket`** overlay (`compareSpriteStack.tsx`); React SVG recipe row (`compareReactSvgRecipe.tsx`). Preset dropdown: six `ticketPresets`.

## Ticket tokens

`ticketPresets.ts` is the TS mirror of Fortunamania `TicketCatalog.module.css`: `resolveTicketMetrics(innerWidth, innerHeight)` runs the same media cascade (presets plus `cellMarginTop` / `numberDrop` / `separatorLift`). `applyTicketCssVars` writes the tokens inline. Do not re-add token media blocks to `index.css`; only the frame band (GameGrid / TicketGrid) lives there.

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
| `src/ticketCatalog/constants.ts` | `MAX_TICKETS`, pool sizes, tile budget (not geometry) |
| `src/ticketCatalog/canvas/CanvasPool.ts` | Tiles · svg-all paint |
| `src/ticketCatalog/dom/DomPool.ts` | Viewport DOM cards |
| `src/ticketCatalog/dom/bands.ts` | DOM band |
| `src/ticketCatalog/canvas/paint/catalogSvgPaint.ts` | Primary svg-all tile paint |
| `src/ticketCatalog/canvas/paint/catalogPaint.ts` | Legacy sprite-blit tile paint |
| `src/ticketCatalog/layout/cellBoxModel.ts` | `activeDpr`, cell CSS vars |
| `src/ticketCatalog/_legacy/` | Dead per-ticket bake — do not import |
| `src/catalog/Compare.tsx` | DOM ↔ canvas match view (React) |
| `src/catalog/reactSvgRaster.ts` | React SVG → static markup → canvas cache |
| `src/catalog/compareSpriteStack.tsx` | Compare DOM + sprite canvas |
| `src/catalog/compareReactSvgRecipe.tsx` | Compare badge · tutorial recipe |
