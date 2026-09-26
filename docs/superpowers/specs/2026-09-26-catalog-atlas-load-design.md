# Catalog atlas load & persistence — design spec

**Date:** 2026-09-26  
**Status:** Draft for review  
**Decisions locked (grilling):** Q1 C→B · Q2 B · Q3 A · Q4 A (if fastest)

## Goals (priority order)

1. **Pixel match (priority 2):** Catalog ticket **id** paint stays **5032e76**: per-digit stack, right edge from `layout.cardWidth` + `headerPadX` — no chrome-width anchor, no whole-string id sprites on catalog.
2. **Time to interactive (Q1 C):** First usable catalog (cells + ids + plain chrome) before optional assets finish.
3. **Real-user load (Q1 B):** Shorter 1× cold load after TTI path is in place.
4. **Simplicity (priority 3):** One atlas module boundary; retire redundant IDB keys over time.

Non-goals for this spec: changing Compare’s `idDigitAtlas` / `paintTicket` path; reviving per-ticket bake (`bakeQueue`, etc.).

---

## Current state (summary)

| Asset | IDB today | Notes |
|-------|-----------|--------|
| Active cell numbers + dab + mults | `bmp-png\|…` (65 PNG) | Shared by plain **and** gold tickets |
| Disabled cell set | `bmp-png\|…\|disabled` (65 PNG) | Green / locked tickets |
| Id digits | `ticket-id-digits-v2-png` (30 PNG) | normal / gold / disabled colors |
| Chrome | `chrome-v2-png\|…` ×3 | plain, win, disabled |
| Win amounts | **Not persisted** | RAM `amounts` map only |

Workers: `spriteDecode.worker` decodes PNG → `ImageBitmap` for cells/chrome; id digits decode in worker then **copy to canvas on main** for 5032e76 paint. SnapDOM capture and SVG→PNG encode stay on main.

---

## Architecture: single layout pack (Q4 A)

### Why one record

- **Fewer IDB round-trips:** one `get` per layout+DPR instead of 4–6 keys and multiple `openDb` cycles.
- **One worker job:** post all PNG `ArrayBuffer`s once; decode in parallel inside the worker; transfer `ImageBitmap`s back in batches.
- **Atomic versioning:** one `packVersion` + `layoutKey` invalidates stale data together.

Single large read can be slower on very slow storage if the pack is huge; for ~160 small PNGs the dominant cost is **decode**, not IDB read size. We accept one record unless profiling shows regression.

### Record shape

**Store key:** `catalog-atlas-v1|{metrics.id}|cw={cardWidth}|dpr={dpr}`

**Value:**

```ts
type CatalogAtlasPack = {
  key: string;
  packVersion: 1;
  meta: {
    padCss: number;           // badge pad, unchanged
    digitEntries: { color: IdColor; digit: string }[]; // length 30, order fixed
    amountEntries: string[];  // unique win strings, order fixed (Q2 B)
  };
  // Concatenated sections in fixed order; offsets in meta or implicit counts:
  blobs: Blob[]; // PNG only in v1
};
```

**Section order in `blobs` (fixed counts):**

1. **cellsActive** — 65 (60 numbers + dab + 4 multipliers)  
2. **cellsDisabled** — 65  
3. **digits** — 30  
4. **chromePlain** — 1  
5. **chromeWin** — 1  
6. **chromeDisabled** — 1  
7. **amounts** — `meta.amountEntries.length` (0..N)

Legacy keys (`bmp-png|…`, `ticket-id-digits-v1/v2`, `chrome-v1/v2`) are read **once** for migration into the unified pack, then optional cleanup.

### RAM model after hydrate

Unchanged consumer API surface where possible:

- `getCellBitmaps()` / `peekTicketChrome()` / digit map / `amounts` map  
- Implementations backed by one in-memory `CatalogAtlasSession` filled from the pack.

---

## Load phases (Q1 C — TTI first)

### Phase 0 — gate (main, blocking)

- `ensureTicketFont` (unchanged).
- Single IDB `loadSprites(packKey)` → if miss, run **full capture** (existing SnapDOM paths), encode PNG, save pack, then hydrate.

### Phase 1 — minimum paint (blocking before `revealCanvas`)

Decode **only** indices needed for default catalog view:

- `cellsActive` (65)  
- `digits` (30)  
- `chromePlain` (1)  

**Total: 96 PNG decodes.**

Implementation:

- Worker receives buffers for phase-1 slice only (or full pack + `offset/count` per section).
- Id digits: worker → `ImageBitmap` → main converts to **`HTMLCanvasElement`** (5032e76 paint requirement).
- Cells/chrome: keep `ImageBitmap` for `drawImage` where paint already accepts `BitmapSprite`.

Then: `setAtlasReady(65)`, `setIdWarm(30/30)`, **`revealCanvas`**, `syncCanvas`.

### Phase 2 — idle / `requestIdleCallback` (non-blocking)

- Decode `chromeWin`, `chromeDisabled`, `cellsDisabled`.  
- On completion: `canvasPool.refresh()` so gold/green scrolled-away tickets update.

### Phase 3 — amounts (Q2 B)

- On first catalog session: hydrate `amounts` from pack section into RAM (decode to canvas).  
- When a **new** win string appears: capture, append to pack (read-modify-write pack or section append — prefer full pack rewrite with debounce to keep one key).  
- Ticket `useEffect` / `drawBall`: `warmAmounts` becomes “ensure in RAM + persist to pack if new”.

Disabled cells are not needed until round-over green tickets; phase 2 is sufficient.

---

## Id paint (Q3 A — locked)

- **No** catalog whole-string id sprites.  
- **No** `chrome.width` anchor in `paintIdDigits`.  
- Capture: live `rasterizeTicketSvg` per digit × color at atlas warm; store PNG in pack section `digits`.  
- Hydrate: decode to **canvas** before paint (accept main-thread cost for 30 glyphs; only once per session).

Accept known limitation: multi-digit ids (e.g. `577`) may differ slightly from DOM kerning vs single text run — same as 5032e76.

---

## Win amounts (Q2 B)

- Key: `amountCacheKey(text)` unchanged in RAM.  
- Persist: PNG blob per unique string in pack `amounts` section; `meta.amountEntries` parallel array.  
- Hydrate phase 3 or on-demand before painting a ticket with `ticket.win` on canvas.  
- Capture path: same as today (`shrinkToInk` on `.ticketCard__win`) → `svgBlobToPngBlob` → append to pack.

---

## Worker responsibilities

| Task | Where |
|------|--------|
| IDB read | Main (single transaction) |
| PNG → ImageBitmap | **Worker** (`spriteDecode.worker`, extend for section batches) |
| ImageBitmap → canvas (digits only) | Main (5032e76) |
| SnapDOM / SVG→PNG on capture | Main |
| Pack write | Main (after capture/migrate) |
| `paintTile` | Main |

Extend worker protocol:

```ts
{ id, buffers: ArrayBuffer[], section: 'phase1' | 'phase2' | 'all' }
→ { id, bitmaps: ImageBitmap[] }
```

Chunk size cap (e.g. 32 buffers per message) if transfer limits bite; still one IDB read.

**Not moved:** `normalize.worker` (Compare/cellAtlas only; stays off for catalog).

---

## Migration

1. On pack miss, try legacy keys in order; if any hit, assemble in-memory pack, save `catalog-atlas-v1`, continue.  
2. Do not delete legacy keys automatically (user can clear site data).  
3. `packVersion` bump only when section layout changes.

---

## Catalog.tsx warm sequence (target)

```text
startAtlasWarm:
  phase0 font + load pack (or capture full)
  phase1 decode slice → revealCanvas
  phase2 idle decode rest → refresh
  phase3 amounts hydrate (from pack + lazy capture)
  scheduleLandscapePrewarm unchanged but runs after phase1 (optional: defer further)
```

Remove parallel duplicate loads of separate keys; one loader module owns the state machine.

---

## Code organization (priority 3, scoped)

- **New:** `catalogAtlasPack.ts` — pack key, load/save, migrate, phase decode orchestration.  
- **Shrink:** `cellBitmaps.ts` / `headerGlyphs.ts` call into pack loader; stop owning separate IDB keys.  
- **Keep:** `ticketSvgRaster.ts`, `spriteDecodeClient.ts` / worker.  
- **Docs:** Update `AGENTS.md` catalog paint sources (`cellBitmaps` + `headerGlyphs`, not `cellAtlas` / `idDigitAtlas` for catalog).

---

## Testing / acceptance

| Check | How |
|-------|-----|
| Id alignment | Scroll DOM/canvas handoff; compare id right edge vs live card (manual + Compare if needed). |
| TTI | `revealCanvas` fires after phase1 only; gold ticket off-screen may lack win chrome until phase2 (&lt;1s idle). |
| Amounts after reload | Tickets with `win` show amount on canvas without re-draw warm. |
| 20× throttle | Phase1 decode count 96 not 163; wall time should drop vs today (measure before/after). |
| 1× cold load | Second visit: single IDB get + phased decode. |

Optional later: TypeSafe **Noul** in CI (“id within 1px of DOM”) — out of scope for first implementation PR.

---

## Self-review

- No TBD sections; Q3 A explicitly accepts kerning tradeoff.  
- Single pack + phased decode consistent with Q4 A and Q1 C.  
- Amounts in pack satisfies Q2 B without contradicting 5032e76 ids.  
- Scope is one implementation plan (pack + phases + migration), not full repo cleanup.

---

## Open for implementation plan

After approval of this spec, use **writing-plans** to sequence:

1. `catalogAtlasPack` types + save/load + migration  
2. Phase 1/2 decode + `startAtlasWarm` wiring  
3. Amounts section + `warmAmounts` persist  
4. Remove obsolete per-key saves  
5. AGENTS.md alignment  
