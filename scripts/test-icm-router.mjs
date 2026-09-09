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

assert.deepEqual([...ICM_SPECIALIST_IDS].sort(), [
  'customer-advisor',
  'diagnostician',
  'estimator',
  'evidence-reviewer',
  'installation-reviewer',
  'knowledge-assistant',
  'lead-analyzer',
  'operations-copilot',
  'visualizer',
]);
for (const id of ICM_SPECIALIST_IDS) {
  const contract = specialistContract(id);
  const prompt = specialistPrompt(id);
  assert.ok(contract.job && contract.evidence && contract.output && contract.never, `${id} contract incomplete`);
  assert.ok(prompt.includes('SPECIALIST CONTRACT') && prompt.includes(contract.job), `${id} prompt not assembled`);
}

// Internal-only routes are opt-in. Public Ask must never enter internal contracts.
const internalCases = [
  ['Analyze this new lead and tell me what is missing.', 'lead-analyzer'],
  ['Review the photo evidence against the closeout requirements.', 'evidence-reviewer'],
  ['What needs attention in the command center today?', 'operations-copilot'],
  ['What does our installation guidance say about this?', 'knowledge-assistant'],
  ['Create a visualizer mockup for this replacement.', 'visualizer'],
];
for (const [message, expected] of internalCases) {
  assert.equal(routeAsk({ message, surface: 'internal' }).id, expected, `${message} → internal ${expected}`);
  assert.notEqual(routeAsk({ message }).id, expected, `${message} must not expose an internal route publicly`);
}

// Pricing language wins over generic planning/advisor language at the router
// level; diagnosis remains the default for symptom-only questions.
assert.equal(routeAsk({ message: 'How much will it cost to fix this leak?' }).id, 'diagnostician', 'documented route precedence: symptom-first');
assert.equal(routeAsk({ message: 'What price should I budget for replacing these windows?' }).id, 'estimator');

console.log(`ICM router + specialist contracts: ${cases.length + 3 + internalCases.length} routing cases passed`);
