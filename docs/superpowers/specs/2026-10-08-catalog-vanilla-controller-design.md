# Catalog vanilla controller (`src/ticketCatalog`)

Home route uses `mountTicketCatalog()` — no React. Compare remains in `src/catalog/`.

## Layout

- **`ticketCatalog/`** — ticket rendering, canvas tiles, DOM pool, layout, gestures, atlas paint.
- **`catalog/`** — `/compare` only (React + compare* modules).

## Behavior

- **Scroll:** no work while moving; `scrollend` → `syncDom` + `setSkip`.
- **Resize:** DOM/CSS immediate via `applyLayout`; canvas debounced **300ms**; skip canvas if `layoutCacheKey` unchanged (DPR-only refresh when bucket changes).
- **Zoom:** `visualViewport.resize` debounced to canvas flush only (no `vv.scroll` → layout).

## Entry

`main.tsx` → `mountTicketCatalog({ root })` after font gate.
