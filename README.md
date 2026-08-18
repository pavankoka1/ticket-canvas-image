# Canvas bitmap cache POC

1. **+100** → **strict bake** every ticket to `ImageBitmap` (retries + assert) **before** tickets enter the catalog
2. **Viewport** (~360px, game-grid sized) → always real DOM
3. **Scroll** → 400 canvas nodes as underlay around the DOM band (path ahead/behind already painted)
4. No layer flip; DOM stays on top

## Run

```bash
cd bingo-canvas-cache-poc
npm install
npm run dev
```

## What to verify

1. **+100** — wait for `baking N/100`; tickets appear only when `cache ✓`
2. Scroll — `canvas` count ~400 (or less near edges); no blank rows in the path
3. Viewport height stays 360px
4. Another +100 — full bake again before append

## Key files

| File | Role |
|------|------|
| `src/catalog/bakeQueue.ts` | Strict DOM→bitmap bake + retries |
| `src/catalog/bands.ts` | DOM viewport + 400 canvas underlay window |
| `src/catalog/CanvasPool.ts` | `drawImage` underlay |
| `src/catalog/DomPool.ts` | Viewport DOM |
| `src/catalog/Catalog.tsx` | Bake-first add + scroll sync |
