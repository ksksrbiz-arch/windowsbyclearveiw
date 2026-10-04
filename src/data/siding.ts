// Siding pricing, owner-provided 2026-10-04 (Mark, relayed by Keith). These are LABOR rates only:
// the siding material is a separate cost, quoted in the written estimate. Whole dollars per
// square foot, "starting at" figures, not quotes. Used by src/pages/siding.astro and checked by
// scripts/test-siding-page.mjs; change them here and nowhere else.
export const sidingLabor = {
  newConstruction: 2,
  existingHome: 3,
  boardAndBatten: 4,
} as const;
