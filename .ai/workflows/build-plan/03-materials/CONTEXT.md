# Stage 03 — Materials

## Inputs

`02-openings` output, quote items, manufacturer/product references, and material rules.

## Process

Classify each material as:
- `QUOTE_DERIVED` — directly purchased/represented by the quote;
- `BASELINE` — normally required and safe to identify categorically;
- `CONDITIONAL` — depends on site/product findings;
- `VERIFY` — cannot be responsibly specified from current evidence.

Never invent quantities for site-dependent consumables or product-specific hardware.

## Outputs

`materials.json` containing BUY, LOAD, and VERIFY groups with evidence and source references.

## Stop conditions

A requested item requires an exact product specification that is not available, or a quantity would be fabricated rather than derived.

## Completion

Done when `materials.json` separates BUY / LOAD / VERIFY, every quantity is derived from the quote or marked `VERIFY`, and each product-specific item cites a source. Checked by: `npm run eval:build-plan` and the quality lint in `functions/_lib/build-plan-rules.mjs`.
