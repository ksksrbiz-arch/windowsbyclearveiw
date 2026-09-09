import assert from 'node:assert/strict';
import { routeAsk } from '../functions/ask/_lib/icm-router.mjs';
import { specialistContract, specialistPrompt, ICM_SPECIALIST_IDS } from '../functions/ask/_lib/icm-specialists.mjs';

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

assert.deepEqual(ICM_SPECIALIST_IDS.sort(), ['customer-advisor', 'diagnostician', 'estimator', 'installation-reviewer']);
for (const id of ICM_SPECIALIST_IDS) {
  const contract = specialistContract(id);
  const prompt = specialistPrompt(id);
  assert.ok(contract.job && contract.evidence && contract.output && contract.never, `${id} contract incomplete`);
  assert.ok(prompt.includes('SPECIALIST CONTRACT') && prompt.includes(contract.job), `${id} prompt not assembled`);
}

// Pricing language wins over generic planning/advisor language at the router
// level; diagnosis remains the default for symptom-only questions.
assert.equal(routeAsk({ message: 'How much will it cost to fix this leak?' }).id, 'diagnostician', 'documented route precedence: symptom-first');
assert.equal(routeAsk({ message: 'What price should I budget for replacing these windows?' }).id, 'estimator');

console.log(`ICM router + specialist contracts: ${cases.length + 3} routing cases passed`);
