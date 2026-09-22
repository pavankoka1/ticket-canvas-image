# Canvas bitmap cache POC

DOM cards cover the near viewport. Canvas tiles paint the full catalog underneath, from SnapDOM sprites (cell numbers, header id / win, multiplier badges).

Routes, the DPR rule, and the file map are in `AGENTS.md`. `docs/CANVAS_CACHE_SOLUTIONS.md` is a historical note, not the live paint path.

1. `/` → catalog (`Catalog`)
2. `/compare` or `#compare` → DOM stacked on the same `paintTicket` path (`Compare`)
3. Viewport height is `CATALOG_VIEWPORT_HEIGHT` (200). DOM pool is 80 cards. Canvas is tiled (~150 tickets per tile), not a 400-card window.

## Run

```bash
cd bingo-canvas-cache-poc
npm install
npm run dev
```

## What to verify

1. Add tickets — cells, id, and win render. No bake progress gate.
2. Scroll — DOM count stays within the pool. Canvas tiles stay painted (no blank rows).
3. `/compare` — difference blend shows DOM vs canvas. A 1px miss is a pixel bug, not a nudge to commit.

File map: `AGENTS.md`.
