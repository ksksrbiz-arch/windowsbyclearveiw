import fs from 'node:fs';

const api = fs.readFileSync('functions/internal/api/copilot.js','utf8');
const page = fs.readFileSync('src/pages/internal/copilot.astro','utf8');

const checks = [
  ['same-origin protection', api.includes("new URL(origin).origin === new URL(request.url).origin")],
  ['body ceiling', api.includes('MAX_BODY_BYTES = 96 * 1024')],
  ['message ceiling', api.includes('MAX_MESSAGE_LENGTH = 1000')],
  ['history ceiling', api.includes('MAX_HISTORY_MESSAGES = 10')],
  ['deterministic routing', api.includes("surface: 'internal'")],
  ['specialist contract', api.includes('specialistPrompt(route)')],
  ['controlled facts only', api.includes('BUSINESS_FACTS')],
  ['Groq primary', api.includes('callGroq(env, messages)')],
  ['Gemini fallback', api.includes('callGemini(env, messages)')],
  ['read-only response', api.includes('readOnly: true')],
  ['degraded state', api.includes('degraded: provider ===')],
  ['no mutation claim', api.includes('Do not claim that you changed any business record.')],
  ['UI uses API', page.includes("/internal/api/copilot")],
  ['UI lifecycle binding', page.includes("astro:page-load")],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`\n${checks.length} Copilot contract checks passed.`);
