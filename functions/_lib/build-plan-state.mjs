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
  if (!canTransition(from, to)) throw new Error(`Invalid Build Plan transition: ${from} -> ${to}`);
  const normalizedActor = String(actor || 'unknown').trim().slice(0, 120) || 'unknown';
  const timestamp = new Date(at).toISOString();
  if (to === BUILD_PLAN_STATES.APPROVED) {
    const blockers = Array.isArray(plan?.quality?.blockers) ? plan.quality.blockers : [];
    if (blockers.length) throw new Error('Build Plan cannot be approved while quality blockers remain.');
    if (!plan?.sourceItems || !Array.isArray(plan.sourceItems)) throw new Error('Build Plan approval requires a quote source snapshot.');
  }
  return {
    ...plan,
    status: to,
    stateHistory: [
      ...(Array.isArray(plan?.stateHistory) ? plan.stateHistory : []),
      { from, to, actor: normalizedActor, at: timestamp },
    ],
    approvedAt: to === BUILD_PLAN_STATES.APPROVED ? timestamp : null,
    approvedBy: to === BUILD_PLAN_STATES.APPROVED ? normalizedActor : null,
  };
}

export function assertJobEligible(plan) {
  if ((plan?.status || BUILD_PLAN_STATES.DRAFT) !== BUILD_PLAN_STATES.APPROVED) throw new Error('Job creation requires an approved Build Plan.');
  if (Array.isArray(plan?.quality?.blockers) && plan.quality.blockers.length) throw new Error('Job creation is blocked by Build Plan quality blockers.');
  if (!plan?.sourceItems || !Array.isArray(plan.sourceItems)) throw new Error('Job creation requires a Build Plan quote source snapshot.');
  return true;
}
