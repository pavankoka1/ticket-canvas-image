---
name: frontend-brainstorm
description: Decide a frontend approach before any code for a new feature, an architecture choice, or how should we build this. Invoke with /frontend-brainstorm.
---

# Frontend brainstorm

Do not write code until the user confirms the model.

## Steps

1. Lock one goal and the hard constraints (browsers, budget, files that already exist). Ask only if a missing constraint blocks the choice.
2. Pick one model to decide. One of coordinate space, state ownership, or component ownership. Do not redesign all three.
3. List exactly 3 options. For each, one tradeoff line (cost, risk, what it reuses).
4. Pick one. Say why it wins on the locked constraint.
5. Name the files to touch. No diffs.
6. Stop. Wait for confirmation.

## Canvas or DOM alignment

If the topic is overlay drift, blur, hit-test, zoom, DPR, or resize, stop. Load `canvas-dom-pixels`. Do not design a new renderer, coordinate stack, or camera.

## Output

- Goal
- Constraint
- Model under decision
- Option A / B / C, one tradeoff each
- Pick
- Files

No code. No new dependencies. No fourth option.
