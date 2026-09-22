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

Catalog shows a DOM pool over a full-catalog canvas underlay.

- DOM: near the viewport only. `computeDomBand` + `DomPool`. Pool size `DOM_POOL_SIZE` (80). Viewport height `CATALOG_VIEWPORT_HEIGHT` (200). Scroll throttles DOM rebind and pauses canvas repaint.
- Canvas: `CanvasPool` tiles, ~150 tickets each (`canvasTileTickets`; 100 when dpr ≥ 3). Every ticket is painted. Tiles are not a 400-card window.
- Shared paint: `paintTicket` in `CanvasPool.ts`. `Compare` calls the same function.

Sprites come from SnapDOM of real ticket DOM, keyed by layout / font / dpr, RAM + IndexedDB (`atlasStore.ts`):

- Ball numbers → `cellAtlas.ts`
- Header id and win amount → `idDigitAtlas.ts` (whole-string sprites). `fillText` is only the warm-up fallback inside `paintHeaderText`.
- Multiplier badges → `badgeAtlas.ts`. Plain hits use the dab image.
- Live DOM cards → `TicketCard` in `ticketCardElement.ts`

## DPR

One ratio for DOM snap, atlases, and canvas: `activeDpr()` in `cellBoxModel.ts` = `min(devicePixelRatio, DPR_CAP)` with `DPR_CAP = 4`.

- Snap CSS lengths with `snapCss`. Cell boxes: `resolveCellBoxModel` / `getLiveCellBoxModel`.
- Do not read `window.devicePixelRatio` in paint code. Do not add a second cap.
- Backing stores are `Math.round(css * activeDpr())` in `CanvasPool.paintTile` and `Compare`. That is not `device-pixel-content-box`.

Pixel, overlay, blur, hit-test, zoom, or resize work: load `.cursor/skills/canvas-dom-pixels` (`/canvas-dom-pixels`). Log its probe. Do not change buffer sizing or invent a renderer until those numbers are in.

## Compare

`src/catalog/Compare.tsx` stacks one live DOM card and one canvas per fixture (id-only, and dab + multiplier + win). Toolbar: opacity, `difference` blend, nudge, header and badge sprite overlays. Use it to see drift. Do not bake a nudge into source to hide a 1px miss.

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
| `src/catalog/CanvasPool.ts` | Tiles + `paintTicket` |
| `src/catalog/DomPool.ts` | Viewport DOM cards |
| `src/catalog/bands.ts` | Which slots get DOM |
| `src/catalog/cellBoxModel.ts` | `activeDpr`, `snapCss`, cell boxes |
| `src/catalog/cellAtlas.ts` | Number sprites |
| `src/catalog/idDigitAtlas.ts` | Id / win sprites |
| `src/catalog/badgeAtlas.ts` | Dab + multiplier sprites |
| `src/catalog/ticketCardElement.ts` | DOM ticket |
| `src/catalog/ticketPresets.ts` | Size tokens |
| `src/catalog/catalogLayout.ts` | Columns, card size, active layout |
| `src/catalog/layout.ts` | Pool, tile, viewport constants |
| `src/catalog/ticketFont.ts` | MB-Onest gate |
