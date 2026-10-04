// Siding pricing, owner-provided 2026-10-04 (Mark, relayed by Keith; the plywood, cedar and dry-rot
// figures are from Mark's own text messages the same evening). These are LABOR rates only: the
// siding material is a separate cost, quoted in the written estimate. Whole dollars per square
// foot of total wall area (height times width), "starting at" figures (the plywood tear-off figure
// is stated flat), not quotes. Used by
// src/pages/siding.astro and checked by scripts/test-siding-page.mjs; change them here and nowhere else.
export const sidingLabor = {
  newConstruction: 2,
  existingHome: 3,
  boardAndBattenNewConstruction: 3,
  boardAndBattenExistingHome: 4,
  cedar: 4,
  tearOffPlywood: 2,
} as const;

// "If there is significant suspected dry rot it will add roughly 1k to 2k more." (Mark, 2026-10-04)
export const sidingDryRot = { low: 1000, high: 2000 } as const;
