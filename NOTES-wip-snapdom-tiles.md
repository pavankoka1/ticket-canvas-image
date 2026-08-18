# Snapshot of the abandoned SnapDOM-tile WIP

Rolled back on 18 Aug 2026 to **`15e3b68` (`first commit`)** — the last version that felt glitchless.

This file is **not** part of `15e3b68`. It is a record of the working tree we left behind so we do not re-derive it from chat.

## How to get the WIP back

```bash
# Uncommitted SnapDOM-tile work (CaptureQueue, per-ticket snap, idle overlay, size hacks)
git stash list          # stash@{0}: WIP snapdom skeleton tiles (pre-rollback to 15e3b68)
git stash show -p stash@{0} --stat

# Committed TilePool rewrite that sat on main after 15e3b68 (no CaptureQueue yet)
#   d751d0b → 66c55f5 → 5b4ed2e   [LCE-330116]: DOM Virtualization + canvas background
git log --oneline 15e3b68..origin/main
```

Local `main` is now **3 commits behind `origin/main`**. Do not force-push.

---

## What `15e3b68` is (restored)

Single-canvas underlay + viewport DOM overlay. Bake is a **sheet SnapDOM**, then a **worker crop**.

| Piece | Role |
|---|---|
| `DomPool` | 48 pooled overlay cards on the viewport |
| `CanvasPool` | **One** `<canvas>` for the scroll window (≤400 tickets) |
| `DomCaptureStage` | Offscreen sheet of cards |
| `captureDomTicket.captureSheetToBitmaps` | One `snapdom.toCanvas(sheet)` for the whole sheet |
| `BakeCropClient` / `bakeCrop.worker` | Crop the sheet into per-ticket `ImageBitmap`s |
| `bakeQueue` | Background bake after `+N` |
| `bitmapCache` | `Map<id, ImageBitmap>` |

Layout: `COLUMNS=5`, `197×43`, gaps `4`, viewport `200px`, `DOM_POOL_SIZE=48`, `CANVAS_BAND_CAPACITY=400`.

Blit: `drawImage(bitmap, dx, dy, CARD_WIDTH*dpr, CARD_HEIGHT*dpr)` with a round-rect clip. Canvas CSS size = `contentWidth()` × band height; backing = CSS × `min(dpr, 2)`.

Scroll: DOM stays on the viewport; canvas paints viewport + overscan as underlay (no idle/scroll mode split, no tile pool).

---

## What the abandoned WIP was (stash + `5b4ed2e`)

Goal: moneyball-ish **skeleton tiles** so `+100` / scroll never freeze on SnapDOM.

| Layer | Count | Role |
|---|---|---|
| DOM pool | 100 | Idle viewport only |
| Canvas tiles | 10 pooled (`TilePool`) | Scroll + corridors. Skeleton chrome, then SnapDOM stamps |
| Bitmap cache | per ticket | Survives tile recycle (`ticketBitmapCache`, `HTMLCanvasElement` not `ImageBitmap`) |

### Runtime split

- **Scroll:** canvas `drawImage` / tile rebind only. No SnapDOM.
- **Idle (~180ms):** DOM overlay on the viewport. Tiles that overlap the viewport are **not** bound (DOM sits there). Corridor tiles stay.
- `ignoreScrollRef` around programmatic `scrollTop = contentHeight - clientHeight` so `+100` does not enter scroll mode.

### Capture (this is the part that never matched DOM size)

- `CaptureQueue`: **one SnapDOM at a time**, never while scrolling. Live `getSlots()` each ticket; do not drop pending until success; `failed` set; re-`enqueueMissing` at end of drain.
- `captureTicket.ts`: one offscreen `TicketCard` in `.catalog__captureHost` (`position:fixed; left:-10000px`).
- Last attempt captured the **root** (explicit 197×43), `filter:none`, `overflow:hidden`, `backgroundColor:'transparent'`, `width/height` from `offsetWidth/Height`, `dpr`, `scale:1`, `embedFonts:true`, `outerTransforms:false`, `cache:'soft'`.
- Returned the SnapDOM **canvas** (no `createImageBitmap`).
- Last-ditch hack: `fitOpaqueToCard` scanned the opaque bbox and stretched it to `197*dpr × 43*dpr`.
- Blit dest locked to `round(CARD_WIDTH*dpr) × round(CARD_HEIGHT*dpr)` with identity transform (because a native 1:1 blit of a CSS-sized snapshot onto a DPR tile shrank tickets).
- Canvas stamps also painted a CSS-matching `drop-shadow` (overlay cards have `filter: drop-shadow(0 2px 4px …)`).

### Tile geometry (WIP)

- `TILE_ROWS=8`, `TILE_POOL_SIZE=10`
- `tileY(tile) = tile * 8 * 47` → **376px** stride
- `tileCssHeight() = 8*43 + 7*4` → **372px** (4px unpainted strip = the row gap between tiles)
- Backing `round(css * dpr)`; CSS `contentWidth() × tileCssHeight()` (1001×372 CSS)

### Logs

- `snap:start {queued, tickets}`
- `snap:tick` every 50 `{ok, pending, lastSnap, lastBmp, out, expect, elapsed, avg}`
- `snap:done {ok, fail, tickets, cache, missing, elapsed, avg, avgSnap, avgBmp}`

---

## Why we rolled it back

Scroll canvas tickets stayed **visually narrower** than idle DOM, so gaps looked larger. Workarounds (dest-size lock, capture-root instead of scaler, opaque-bbox stretch, canvas drop-shadow) did **not** fix it. Root cause was not proven; stop guessing on top of this stack.

Playwright (dpr=2) had seen SnapDOM `out: 394×86` (= 197×43 at 2×) while the painted cream face AABB was still ~196×42 CSS — either SnapDOM letterboxing inside the raster, or a CSS/backing mismatch on the tile. Do not treat that as settled.

---

## Do not retry (already failed)

1. Batch / `Promise.all` SnapDOM on `+100` (~100ms × N main-thread lockup).
2. `paintTicket` `fillText` trying to match SnapDOM ink (Mac/Linux Y drift).
3. Worker tile compose + `createImageBitmap` clone (~4× wall-clock). SnapDOM cannot run in a worker.
4. `cache: 'full'` / `burst: true` on **one reused capture card** with changing text → stale tickets.
5. `isInputPending()` / per-ticket `scheduler.yield` — Mac hover makes `isInputPending` true → one frame per ticket.
6. Extra round-rect clip on blit shifting glyphs vs DOM.
7. Stretching SnapDOM’s opaque bbox to “fill” 197×43 (still looked small).
8. Capturing `.ticketCard__scaler` (`inset:0`) as the SnapDOM root (clone has no containing block).

Product constraints that still apply on the next attempt:

- Scroll path = canvas blit only (no SnapDOM).
- Idle ≈ 180ms → DOM on the viewport; canvas must not sit on/under those DOM cards.
- Do not freeze the UI with per-ticket bake-on-add.
- Do not put `cache:'full'` on a reused capture node.
- Moneyball / `libraries/core` stay out of scope unless asked.
