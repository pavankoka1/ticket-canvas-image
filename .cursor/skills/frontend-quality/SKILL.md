---
name: frontend-quality
description: Short checklist for writing or reviewing React and TypeScript UI, performance, or a pull request. Invoke with /frontend-quality.
---

# Frontend quality

Apply this checklist only. Do not paste a long rule catalog.

## Checklist

- No `any`. Type the boundary or narrow it.
- Reuse an existing component before adding one. Search first.
- Put `'use client'` only on leaves that need it. Do not mark a whole tree. Skip this line when the app has no server components.
- No request waterfalls. Start independent fetches together.
- No extra rerender subscriptions. Subscribe to the slice the view reads.
- Measure before `memo`, `useMemo`, or `useCallback`. Add one only when a profile shows the cost.
- Keep components small. Split when one component owns unrelated state or a second layout.

## Review

- Flag a violation with the file and the checklist line it breaks.
- Do not rewrite a file for nits outside this list.
- If the diff touches an overlay, canvas, HUD, or hit-test, do not review the pixel math here. Load `canvas-dom-pixels` and require its probe first.

## Skip

- Do not dump Vercel's full rule list.
- Do not add an abstraction unless a checklist line fails.
