# Catalog scroll + resize canvas underlay

## Problem

- During scroll, the DOM band and canvas `skipIds` only updated on scroll settle, leaving viewport rows in skip holes with no DOM → blank catalog.
- Window resize/zoom cleared and hid the canvas without `revealCanvas()` when layout key was unchanged.

## Solution

1. **Scroll:** zero band/canvas work (static tile bitmap scrolls with content). On settle: `syncDom` + `setSkip` for the new band.
2. **Viewport:** `visualViewport` + resize update viewport state only (no `clear()`/`hide`). Same layout key → `syncCanvas`, `syncDom`, `revealCanvas` if ready; DPR change → `refresh()`. Layout key change → existing settle rebuild.

## Success criteria

- Canvas tickets visible while scrolling with 100+ tickets.
- Resize/zoom without permanent hidden canvas.
- No double-draw at rest (skip matches DOM band).
