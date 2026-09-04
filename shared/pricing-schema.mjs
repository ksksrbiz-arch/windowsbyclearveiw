/**
 * The one definition of "valid pricing", shared by the site and the pricing
 * worker. Plain ESM with no dependencies so a Cloudflare Worker can import it
 * unchanged.
 *
 * This is deliberately about *integrity*, not about whether a number is the
 * right market rate — nothing can check that automatically. It catches the
 * failure modes that would silently produce a wrong quote: inverted ranges,
 * missing types, absurd spreads, a multiplier someone fat-fingered.
 */

/** A high/low spread wider than this is almost always a typo, not a range. */
const MAX_SPREAD_RATIO = 5;

/** Sanity rails. Outside these, somebody meant something else. */
const LIMITS = {
  openingLow: { min: 100, max: 10_000 },
  openingHigh: { min: 100, max: 25_000 },
  fullFrame: { min: 0, max: 5_000 },
  modifier: { min: 0, max: 5_000 },
  multiplier: { min: 0.5, max: 3 },
};

function inRange(value, { min, max }) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function checkRange(label, low, high, limitsLow, limitsHigh, problems, { allowZero = false } = {}) {
  if (allowZero && low === 0 && high === 0) return;

  if (!inRange(low, limitsLow)) {
    problems.push(`${label}: low (${low}) is outside ${limitsLow.min}–${limitsLow.max}`);
  }
  if (!inRange(high, limitsHigh)) {
    problems.push(`${label}: high (${high}) is outside ${limitsHigh.min}–${limitsHigh.max}`);
  }
  if (typeof low === 'number' && typeof high === 'number') {
    if (high < low) {
      problems.push(`${label}: high (${high}) is below low (${low})`);
    } else if (low > 0 && high / low > MAX_SPREAD_RATIO) {
      problems.push(
        `${label}: spread is ${(high / low).toFixed(1)}× (${low}–${high}), wider than ${MAX_SPREAD_RATIO}× — likely a typo`,
      );
    }
  }
}

/**
 * @returns {{ ok: boolean, problems: string[], warnings: string[], ageDays: number|null }}
 */
export function validatePricing(doc, now = new Date()) {
  const problems = [];
  const warnings = [];

  if (!doc || typeof doc !== 'object') {
    return { ok: false, problems: ['pricing document is missing or not an object'], warnings, ageDays: null };
  }

  // --- basis ---------------------------------------------------------------
  const basis = doc.basis;
  let ageDays = null;
  if (!basis || typeof basis !== 'object') {
    problems.push('basis is missing');
  } else {
    if (basis.source !== 'averages' && basis.source !== 'clearview') {
      problems.push(`basis.source must be "averages" or "clearview", got ${JSON.stringify(basis.source)}`);
    }
    const reviewed = new Date(`${basis.reviewedAt}T00:00:00Z`);
    if (Number.isNaN(reviewed.getTime())) {
      problems.push(`basis.reviewedAt is not a date: ${JSON.stringify(basis.reviewedAt)}`);
    } else {
      ageDays = Math.floor((now.getTime() - reviewed.getTime()) / 86_400_000);
      if (ageDays < 0) problems.push(`basis.reviewedAt is in the future (${basis.reviewedAt})`);
      const maxAge = Number(basis.maxAgeDays) || 180;
      if (ageDays > maxAge) {
        warnings.push(`pricing was last reviewed ${ageDays} days ago, past the ${maxAge}-day limit`);
      }
    }
  }

  // --- openings ------------------------------------------------------------
  const openings = Array.isArray(doc.openings) ? doc.openings : [];
  if (openings.length === 0) problems.push('no opening types defined');

  const seen = new Set();
  for (const opening of openings) {
    const id = opening?.id ?? '(no id)';
    if (seen.has(id)) problems.push(`duplicate opening id: ${id}`);
    seen.add(id);
    if (!opening?.label) problems.push(`opening ${id}: missing label`);
    // An unpriced type is allowed — the site hides it rather than counting $0.
    if (opening?.low === 0 && opening?.high === 0) {
      warnings.push(`opening ${id} has no price and will be hidden from the estimator`);
      continue;
    }
    checkRange(`opening ${id}`, opening?.low, opening?.high, LIMITS.openingLow, LIMITS.openingHigh, problems);
  }

  if (openings.length > 0 && openings.every((o) => o?.low === 0 && o?.high === 0)) {
    problems.push('every opening type is unpriced — the estimator would have nothing to show');
  }

  // --- materials -----------------------------------------------------------
  const materials = Array.isArray(doc.materials) ? doc.materials : [];
  if (materials.length === 0) problems.push('no materials defined');
  if (materials.length > 0 && !materials.some((m) => m?.multiplier === 1)) {
    problems.push('no material has multiplier 1 — one must be the baseline');
  }
  for (const material of materials) {
    if (!inRange(material?.multiplier, LIMITS.multiplier)) {
      problems.push(
        `material ${material?.id ?? '(no id)'}: multiplier ${material?.multiplier} is outside ${LIMITS.multiplier.min}–${LIMITS.multiplier.max}`,
      );
    }
  }

  // --- brands ----------------------------------------------------------------
  // Optional — older pricing documents (and the worker's stored copy, until
  // it is next PUT) may not have this field yet, so an empty/missing array
  // is not an error, just nothing to check.
  const brands = Array.isArray(doc.brands) ? doc.brands : [];
  if (brands.length > 0 && !brands.some((b) => b?.low === 0 && b?.high === 0)) {
    problems.push('no brand has zero added cost — one must be the baseline');
  }
  for (const brand of brands) {
    checkRange(
      `brand ${brand?.id ?? '(no id)'}`,
      brand?.low,
      brand?.high,
      LIMITS.modifier,
      LIMITS.modifier,
      problems,
      { allowZero: true },
    );
  }

  // --- full frame ----------------------------------------------------------
  if (!doc.fullFrame) {
    problems.push('fullFrame is missing');
  } else {
    checkRange('fullFrame', doc.fullFrame.low, doc.fullFrame.high, LIMITS.fullFrame, LIMITS.fullFrame, problems);
    if (doc.fullFrame.high === 0) {
      problems.push('fullFrame has no price — full-frame jobs would quote the same as inserts');
    }
  }

  // --- modifiers -----------------------------------------------------------
  for (const modifier of Array.isArray(doc.modifiers) ? doc.modifiers : []) {
    checkRange(
      `modifier ${modifier?.id ?? '(no id)'}`,
      modifier?.low,
      modifier?.high,
      LIMITS.modifier,
      LIMITS.modifier,
      problems,
      { allowZero: true },
    );
  }

  return { ok: problems.length === 0, problems, warnings, ageDays };
}
