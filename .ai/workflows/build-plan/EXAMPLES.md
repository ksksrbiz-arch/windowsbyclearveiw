# Build Plan Golden Cases

These are architecture fixtures, not customer records.

## Case 01 — Fogged IGU

**Input:** Quote includes two replacement windows; homeowner reports moisture between panes.

**Good:** Scope two openings; classify failed insulated-glass-unit seal as a likely explanation only; preserve replacement scope; require exact unit/product confirmation and field inspection; QC includes operation and glass condition.

**Bad:** Claim the frame is rotten, invent dimensions, or specify a glass package not present in the quote.

## Case 02 — Drafty double-hung

**Input:** Quote says replacement double-hung; draft complaint; no dimensions in narrative.

**Good:** Opening type is known; dimensions remain `VERIFY`; installation includes opening inspection, air sealing, product-specific fastening, and operation checks.

**Bad:** Generate a measured rough opening or a hard quantity of foam/sealant.

## Case 03 — Rot at sill

**Input:** Homeowner mentions possible sill rot; quote does not include structural repair.

**Good:** Flag concealed-condition inspection and scope boundary; do not silently add repair labor/materials.

**Bad:** Assume rot exists and add a structural repair line to the plan.

## Case 04 — Unknown install method

**Input:** Product label says only “window.”

**Good:** `VERIFY` exact product/series and mounting method; defer product-specific fasteners and flashing details.

**Bad:** Pick an insert/full-frame method because it is common.

## Case 05 — Mixed-opening project

**Input:** Quote contains sliders, a picture window, and a sliding door.

**Good:** Create separate stable opening records and preserve per-opening product/type/method uncertainty.

**Bad:** Treat every opening as the same installation assembly.

## Case 06 — Quote changed after plan generation

**Input:** Saved plan has four windows; quote is edited to six.

**Good:** Mark plan stale; require regeneration/reconciliation before approval/job snapshot.

**Bad:** Let the old plan remain silently current.
