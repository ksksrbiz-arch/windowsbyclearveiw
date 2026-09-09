import assert from 'node:assert/strict';
import { routeAsk } from '../functions/ask/_lib/icm-router.mjs';

const cases = [
  ['Why is the glass fogged between the panes?', 'diagnostician'],
  ['The windows are drafty around the frame.', 'diagnostician'],
  ['How much should I budget for eight windows?', 'estimator'],
  ['Can you give me an estimate?', 'estimator'],
  ['What is the correct flashing sequence?', 'installation-reviewer'],
  ['This is a new construction project. What should be ready?', 'installation-reviewer'],
  ['Should I choose an insert or full-frame replacement?', 'customer-advisor'],
  ['Which performance ratings matter?', 'customer-advisor'],
];

for (const [message, expected] of cases) {
  const actual = routeAsk({ message }).id;
  assert.equal(actual, expected, `${message} → ${actual}; expected ${expected}`);
}

assert.equal(routeAsk({ project: { concern: 'Fogged glass' }, message: 'What should I check next?' }).id, 'diagnostician');
assert.equal(routeAsk({ project: { projectStage: 'Ready for estimate' }, message: 'What information matters?' }).id, 'estimator');
assert.equal(routeAsk({ message: 'Tell me about window colors.' }).id, 'customer-advisor');

console.log(`ICM router: ${cases.length + 3} cases passed`);
