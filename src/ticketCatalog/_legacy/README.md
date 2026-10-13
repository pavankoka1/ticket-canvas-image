# Legacy per-ticket bake path

These modules implemented an unused DOM capture → worker crop → per-ticket bitmap cache flow. The live catalog uses cell atlases (`canvas/atlas/`) and svg-all paint instead.

Do not import from this folder. Listed in `AGENTS.md` so new work does not revive them.

`fullTicketSnap.ts` had no callers; kept here for history.
