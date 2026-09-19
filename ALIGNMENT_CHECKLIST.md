# Canvas cell atlas — alignment checklist

## Done in code

- [x] **Fixed-px cell box** — `cellW = (ticketWidth − 6) / 6`.
- [x] **Real ticket HTML SnapDOM** — first cell of `createTicketDom()`, not a synthetic sheet.
- [x] **Font identity in cache key** — `document.fonts.check`.
- [x] **Measured cell tops in geometry** (`v10-measured-y`) + absolute device-pixel blit (mechanism A).
- [x] **`[YDRIFT]` log + sprite-over-DOM toggle** — separate placement (A) vs SnapDOM raster (B).

## Linux evidence (run this)

1. Hard refresh → **Rebuild atlas**.
2. Console `[YDRIFT]`:
   - fractional `dpr` + `modelDeviceTop ≠ actualDeviceTop` → A contributes.
3. Toggle **sprite-over-DOM**:
   - overlay glyph aligns with live number → drift was **A** (placement).
   - overlay still ~0.5px high → **B** (foreignObject / FreeType).

## Still open

- [ ] Multiplier / won settled atlas
- [ ] Backing-store memory on low-end
- [ ] Full Win/Linux/Android DPR matrix
