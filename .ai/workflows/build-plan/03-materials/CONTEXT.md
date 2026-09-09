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
