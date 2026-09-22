# Bingo canvas cache — solutions

> Historical design note. Live routes, DPR, and the file map are in `AGENTS.md`. Header id and win paint as SnapDOM sprites in `idDigitAtlas.ts` (`fillText` is only the warm-up fallback). Do not implement from the sections below.

Current architecture (as built): a **per-cell sprite atlas**. For each layout size we
SnapDOM-capture the 60 ball numbers (1…60) from a real `.ticketCard__cell`, over white,
un-matte to transparent, and bake a vertical `inkShift` so the glyph lands where native DOM
text sits. Sprites are cached in RAM (`ramCache`) + IndexedDB (`atlasStore`), keyed by
layout/font/dpr. `CanvasPool` blits those sprites into a tiled underlay; DOM overlays the
viewport. This part works cross-OS.

---

## 6. What actually paints the ticket ID (correction)

Your assumption is wrong, and that's the bug. The ID is **not** SnapDOM. It is canvas text:

`CanvasPool.paintChrome()` → `Ticket id (still fillText for now…)`:
```ts
ctx.fillStyle = gold ? "#9F8080" : "#B19797";
ctx.font = `700 ${m.metaFontSize}px MB-Onest, Onest, system-ui, sans-serif`;
ctx.textAlign = "right";
ctx.textBaseline = "bottom";
ctx.fillText(ticketNo, x + cardWidth - m.headerPadX, y + m.headerHeight - 1);
```
Win amount is **not painted at all**.

`ctx.fillText` rasterises through the OS text engine — CoreText (Mac), FreeType (Linux),
DirectWrite (Windows) — with different hinting, subpixel positioning and metrics than the
DOM's `foreignObject` path that the number sprites use. It happens to line up on Mac and
drifts ~0.5px on Linux/Windows. No amount of tweaking the `-1` / baseline will make canvas
`fillText` match DOM text on all three OSes. **The fix is to stop using `fillText` and use
the same sprite mechanism that already works for the ball numbers.**

---

## 4. Ticket ID + win amount solution — glyph sprite atlas

Build a **glyph atlas** the exact same way as the cell atlas, but for the header text.

### Source CSS (from `Ticket.module.css`)
- `.ticketCard__id`: `font-size: var(--ticket-meta-font-size)` (12 / 11 / 10 / 12 / 9 per
  preset), `font-weight: 700`, `MB-Onest`, `line-height: normal`, `color: #B19797`
  (win-gold `#9F8080`, disabled `#0F6864`), `text-align: right`. Sits in the header
  (`justify-content: flex-end` → bottom-aligned), header `padding: 0 var(--ticket-header-pad-x)`.
- `.ticketCard__win`: same font, `color: #704F4F` (disabled `#0F6864`), `text-align: left`,
  `justify-content: flex-end` (bottom-aligned), `align-items: flex-start`.

### Sprites to capture (small set, cheap)
- Digits `0–9`.
- Win separators/symbols actually used: `.` `,` space, and the currency glyph(s).
- One capture pass per **color** (normal id `#B19797`, win-gold id `#9F8080`, win text
  `#704F4F`, and disabled if the catalog can be disabled). ~15 glyphs × colors, one-time.

Capture each glyph as a single-char `.ticketCard__id` / `.ticketCard__win` span inside a
real `.ticketCard__header` (identical CSS, same font-load gate as `buildAtlas`), over white,
`unmatteFromWhite`, then bake `inkShift`. Store in the generic sprite store
(`saveSprites`/`loadSprites` — already present, comment even names "ID digits"). meta =
`{ perGlyphAdvance, inkShift, spriteW, spriteH }`.

### Vertical alignment (same trick that works today)
Reuse the `measureBaselineFromCellTop` + `inkOffsetFromBaseline` → `inkShift` machinery,
but measured against the **header line box** of the real `.ticketCard__id` span instead of
the body cell. This is what already kills the vertical drift for the numbers.

### Horizontal alignment (the part `fillText` gets wrong)
Do **not** trust `ctx.measureText` advances — they are canvas metrics and differ from DOM.
Measure the real per-glyph x-positions from the DOM once, using the Range API on a live
`.ticketCard__id` span:
```ts
const range = document.createRange();
// for each character index i in the rendered string:
range.setStart(textNode, i); range.setEnd(textNode, i + 1);
const r = range.getBoundingClientRect();   // exact DOM sub-pixel x/width for that glyph
```
If MB-Onest digits are **tabular** (equal advance — very likely for a game font), a single
measured digit-advance is enough and you just step by it. If not tabular, store per-glyph
advance. Either way the advances come from the DOM pipeline, so the run is identical on
every OS.

### Paint
```
ID  (right-aligned): pen starts at deviceX = round((slotX + cardWidth - headerPadX) * dpr).
                     Walk the string right→left, subtract each glyph advance, blit sprite.
WIN (left-aligned):  pen starts at deviceX = round((slotX + headerPadX) * dpr).
                     Walk left→right, blit sprite, add advance.
Vertical: same absolute device-px baseline as the number sprites (inkShift baked in).
```
Blit with identity transform at integer device px (`ctx.setTransform(1,0,0,1,0,0)`), exactly
like the number blit at `CanvasPool.ts:240`. Result: ID/win are pixel-identical to DOM on
Mac, Linux and Windows because they're the same rasteriser output the DOM produces.

### Win amount in the POC
Not integrated → generate a random win per ticket in `tickets.ts` (e.g. 30% of tickets get a
formatted amount like `12.50`), store on the `Ticket`, and paint it in `paintChrome` from the
left using the win-color glyph set. Only win tickets (`isWinTicket`) show it, matching prod.

---

## 2. Tear down canvas on resize / orientation, rebuild after 1.5s settle

**Problem today:** `resize` → `setViewport` → layout memo recomputes → the layout effect
re-warms and re-syncs after only **120ms**. The old canvas tiles stay painted (and get
resized to the new geometry mid-flight) while the DOM reflows instantly on top — so a
wrong-sized canvas underlay flashes behind the DOM. There is no orientation handling and no
settle delay.

**Fix:**
1. **On the first resize / `orientationchange` / `screen.orientation` change event:**
   immediately hide + clear the canvas — `canvasHost.style.visibility = "hidden"` and
   `canvasPool.clear()` — and cancel any in-flight atlas warm (bump `atlasGenRef` /
   `buildGen`). The DOM pool already covers the viewport, so hiding the canvas is visually
   safe: the user isn't scrolling into off-viewport (canvas-only) regions during a resize.
2. **Debounce with a 1500ms timer**, reset on every resize event. Only when it fires
   (viewport settled) do you: recompute layout → resolve preset → `warmCellAtlas` (which
   hits RAM/IDB instantly if this size was seen before) → `syncCanvas()` → then
   `canvasHost.style.visibility = "visible"`.
3. Trigger on all three: `window resize`, `window orientationchange`, and
   `matchMedia('(orientation: portrait)')` / `screen.orientation` change (mobile fires these
   more reliably than `resize`).
4. Skip the teardown if the debounced layout key is unchanged (trivial resize) — just show
   the existing canvas back.

Sketch:
```ts
const settleRef = useRef(0);
const onViewportChange = () => {
  canvasHostRef.current!.style.visibility = "hidden";
  canvasPoolRef.current?.clear();
  atlasGenRef.current++;                       // cancel in-flight warm
  if (settleRef.current) clearTimeout(settleRef.current);
  settleRef.current = window.setTimeout(() => {
    settleRef.current = 0;
    setViewport({ w: innerWidth, h: innerHeight });  // recompute layout
    // layout effect then warms atlas + syncCanvas; reveal canvas on warm resolve:
  }, 1500);
};
```
Reveal the canvas host inside the `warmCellAtlas().then(...)` completion (where
`canvasPool.refresh()` already runs), so it only reappears once sprites for the new size are
ready.

---

## 3. Stronger cache + throttle

**Cache key — already strong.** `atlasCacheKey` keys on: preset id, `cardWidth`,
`dpr`, `cellW×cellH`, `numberFontSize/lineHeight`, **font identity** (`document.fonts.check`),
separator width, padY. That is a superset of your requested `width + height + font-size`
(cell height encodes ticket height; cardWidth encodes width). Keep it — it is the right
identity. Apply the identical strategy to the new ID/win glyph atlas, keyed on
`metaFontSize + dpr + font + color`.

Improvements:
- **RAM LRU cap.** `ramCache` is an unbounded `Map` — rotating through sizes leaks
  `ImageBitmap`s. Cap it (e.g. 4–6 entries); on evict, `bitmap.close()` the dropped set.
  IndexedDB can keep many (cheap, disk).
- **Time throttle.** `warmPromiseKey` already dedupes *concurrent* warms for the same key.
  Add a module-level `lastWarmAt` guard so distinct triggers can't rebuild the same key more
  than once per ~2–3s. Combined with the 1.5s resize settle, nothing recomputes on a burst.
- **Font gate already correct** — `document.fonts.ready` + explicit `fonts.load('700 …')`
  before keying/capturing prevents the "thin fallback then re-adjust" bug. Keep.

---

## 5. Further optimisation

Ordered by payoff:

1. **Pack the atlas into one sprite-sheet PNG** instead of 60 separate PNG blobs. Warm-from-
   IDB then does **1** `createImageBitmap` decode + source-rect blits instead of 60 decodes;
   less IDB overhead and heap fragmentation. Biggest win for the IDB path.
2. **Pre-warm likely sizes on idle.** In `requestIdleCallback`, build/load the atlas for the
   portrait ⇄ landscape counterpart size. Then orientation change (§2) finds a RAM/IDB hit
   and the 1.5s rebuild is instant — no visible canvas gap.
3. **Digit atlas is tiny.** The ID/win glyph set is ~15 sprites vs 60 — capture is cheap;
   fold it into the same warm pass so there's one SnapDOM burst per size, not two.
4. **Move `normalizeBitmap` (getImageData/unmatte loops) off the main thread.** SnapDOM must
   run on main (proven in NOTES), but the raw canvases can be handed to a worker for
   unmatte + `createImageBitmap`. One-time cost — profile before doing this; may not be worth
   it given warm is rare and cached.
5. **`createImageBitmap(…, { premultiplyAlpha: 'none' })`** on the normalized output to skip a
   recomposite, and keep `imageSmoothingEnabled=false` on number/id blits (already done).
6. Keep **POOL = 6** parallel captures (NOTES proved batch-all freezes, per-ticket yields
   thrash). Keep **DPR cap = 3**. Keep scroll-pause of tile painting.
7. **Skip the warm-up double-capture** for glyphs where the cold-first-capture artifact
   doesn't appear — measure; if the first capture already matches, drop the discard and halve
   that step.

---

## Net change list
- New `idDigitAtlas.ts` (glyph sprites for id/win) mirroring `cellAtlas.ts`; wire into
  `warmCellAtlas` pass and into `paintChrome` (replace `fillText`).
- `Catalog.tsx`: resize/orientation teardown + 1500ms settle; reveal canvas on warm resolve.
- `cellAtlas.ts`: RAM LRU cap + time throttle.
- `atlasStore.ts`: optional sprite-sheet packing.
- `tickets.ts`: random win amounts for the POC.
