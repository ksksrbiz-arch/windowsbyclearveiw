import assert from 'node:assert/strict';
import { BUILD_PLAN_STATES, canTransition, transitionPlanState, assertJobEligible } from '../functions/_lib/build-plan-state.mjs';

assert.equal(canTransition('draft', 'review'), true);
assert.equal(canTransition('draft', 'approved'), false);
assert.equal(canTransition('review', 'draft'), true);
assert.equal(canTransition('review', 'approved'), true);
assert.equal(canTransition('approved', 'draft'), false);

const clean = { status: BUILD_PLAN_STATES.REVIEW, quality: { blockers: [] }, sourceItems: [{ label: 'Cascade double-hung', quantity: 1 }] };
const approved = transitionPlanState(clean, BUILD_PLAN_STATES.APPROVED, 'mark', '2026-09-08T17:00:00.000Z');
assert.equal(approved.status, 'approved');
assert.equal(approved.approvedBy, 'mark');
assert.equal(approved.approvedAt, '2026-09-08T17:00:00.000Z');
assert.equal(approved.stateHistory.at(-1).to, 'approved');
assert.doesNotThrow(() => assertJobEligible(approved));

assert.throws(
  () => transitionPlanState({ status: 'review', quality: { blockers: ['missing instructions'] }, sourceItems: [] }, 'approved', 'mark'),
  /quality blockers/
);
assert.throws(() => transitionPlanState({ status: 'review', quality: { blockers: [] } }, 'approved', 'mark'), /quote source snapshot/);
assert.throws(() => assertJobEligible({ status: 'approved', quality: { blockers: [] } }), /quote source snapshot/);
assert.throws(() => assertJobEligible({ status: 'draft', quality: { blockers: [] } }), /approved Build Plan/);
assert.throws(() => transitionPlanState({ status: 'approved' }, 'draft', 'mark'), /Invalid Build Plan transition/);
assert.throws(() => transitionPlanState({ status: 'review', quality: { blockers: [] }, sourceItems: [] }, 'approved', 'not-empty', 'not-a-date'), /Invalid time value|Invalid time/i);

console.log('Build Plan state tests passed.');
