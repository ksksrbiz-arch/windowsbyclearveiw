import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const buildPlanApi = read('functions/internal/api/build-plan.js');
const stateApi = read('functions/internal/api/build-plan-state.js');
const quoteApi = read('functions/internal/api/quotes/[id].js');
const jobsApi = read('functions/internal/api/jobs.js');
const editor = read('src/pages/internal/quotes/build-plan.astro');
const approval = read('src/pages/internal/quotes/build-plan-approval.astro');

assert.match(buildPlanApi, /plan\.status=saved\?\.state\|\|plan\.status\|\|'draft'/);
assert.match(buildPlanApi, /ALTER TABLE quote_build_plans ADD COLUMN state/);
assert.match(buildPlanApi, /Approved Build Plans are locked/);
assert.match(buildPlanApi, /source_json/);
assert.match(stateApi, /action === 'approve'/);
assert.match(stateApi, /checked\.stale/);
assert.match(stateApi, /checked\.quality\.blockers\.length/);
assert.match(stateApi, /transitionPlanState/);
assert.match(quoteApi, /BUILD_PLAN_REQUIRED/);
assert.match(quoteApi, /BUILD_PLAN_NOT_APPROVED/);
assert.match(quoteApi, /BUILD_PLAN_STALE/);
assert.match(jobsApi, /BUILD_PLAN_NOT_APPROVED/);
assert.match(jobsApi, /BUILD_PLAN_CHANGED_AFTER_APPROVAL/);
assert.match(jobsApi, /assertJobEligible/);
assert.match(editor, /data-approval-link/);
assert.match(editor, /Review &amp; approve/);
assert.match(editor, /plan\.status==='approved'/);
assert.match(approval, /data-action="approve"/);
assert.match(approval, /sd\.status!=='review'/);

console.log('Build Plan integration wiring: PASS');
