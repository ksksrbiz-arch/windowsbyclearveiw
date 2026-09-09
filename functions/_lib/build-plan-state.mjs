// Deterministic Build Plan lifecycle. Production persistence belongs to the API;
// this module owns the allowed transitions and their invariants.

export const BUILD_PLAN_STATES = Object.freeze({
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
  REOPENED: 'reopened',
});

const TRANSITIONS = Object.freeze({
  draft: new Set(['review']),
  review: new Set(['approved', 'draft']),
  approved: new Set(['reopened']),
  reopened: new Set(['review']),
});

export function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

export function transitionPlanState(plan, to, actor = 'unknown', at = new Date().toISOString()) {
  const from = plan?.status || BUILD_PLAN_STATES.DRAFT;
  if (!canTransition(from, to)) {
    throw new Error(`Invalid Build Plan transition: ${from} -> ${to}`);
  }
  if (to === BUILD_PLAN_STATES.APPROVED) {
    const blockers = Array.isArray(plan?.quality?.blockers) ? plan.quality.blockers : [];
    if (blockers.length) throw new Error('Build Plan cannot be approved while quality blockers remain.');
  }
  return {
    ...plan,
    status: to,
    stateHistory: [
      ...(Array.isArray(plan?.stateHistory) ? plan.stateHistory : []),
      { from, to, actor: String(actor || 'unknown'), at },
    ],
    approvedAt: to === BUILD_PLAN_STATES.APPROVED ? at : null,
    approvedBy: to === BUILD_PLAN_STATES.APPROVED ? String(actor || 'unknown') : null,
  };
}

export function assertJobEligible(plan) {
  if ((plan?.status || BUILD_PLAN_STATES.DRAFT) !== BUILD_PLAN_STATES.APPROVED) {
    throw new Error('Job creation requires an approved Build Plan.');
  }
  if (Array.isArray(plan?.quality?.blockers) && plan.quality.blockers.length) {
    throw new Error('Job creation is blocked by Build Plan quality blockers.');
  }
  return true;
}
