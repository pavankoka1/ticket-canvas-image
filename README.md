# Canvas bitmap cache POC

Visible tickets and the add gesture are DOM. Canvas paints only the tickets that have scrolled away.

Routes, the DPR rule, and the file map are in `AGENTS.md`. `docs/CANVAS_CACHE_SOLUTIONS.md` is a historical note, not the live paint path.

1. `/` → catalog (`Catalog`)
2. `/compare` or `#compare` → DOM stacked on the same `paintTicket` path (`Compare`)
3. The catalog frame matches the Fortunamania ticket box (desktop 1001×231). +1, +5, +25, and +100 add tickets. DOM pool is 80 cards. Canvas is tiled (~150 tickets per tile).

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
