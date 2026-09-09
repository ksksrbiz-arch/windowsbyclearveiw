import fs from 'node:fs';

const files = {
  router: fs.readFileSync('functions/ask/_lib/icm-router.mjs', 'utf8'),
  analyzerApi: fs.readFileSync('functions/internal/api/lead-analyzer.js', 'utf8'),
  analyzerPage: fs.readFileSync('src/pages/internal/leads/analyze.astro', 'utf8'),
  summaryApi: fs.readFileSync('functions/internal/api/copilot-summary.js', 'utf8'),
  copilotPage: fs.readFileSync('src/pages/internal/copilot.astro', 'utf8'),
  state: fs.readFileSync('.ai/STATE.md', 'utf8'),
};

const checks = [
  ['internal lead route exists', files.router.includes("id: 'lead-analyzer'")],
  ['internal evidence route exists', files.router.includes("id: 'evidence-reviewer'")],
  ['internal operations route exists', files.router.includes("id: 'operations-copilot'")],
  ['internal knowledge route exists', files.router.includes("id: 'knowledge-assistant'")],
  ['internal visualizer route exists', files.router.includes("id: 'visualizer'")],
  ['lead analyzer reads bounded D1 data', files.analyzerApi.includes('LIMIT ?') && files.analyzerApi.includes('MAX_LEADS = 25')],
  ['lead analyzer is read-only', files.analyzerApi.includes('readOnly: true') && files.analyzerApi.includes('do not mutate')],
  ['lead analyzer same-origin protected', files.analyzerApi.includes('Cross-origin requests are not allowed.')],
  ['lead analyzer provider fallback', files.analyzerApi.includes('callGroq(env, system, user)') && files.analyzerApi.includes('callGemini(env, system, user)')],
  ['lead analyzer UI uses internal API', files.analyzerPage.includes("/internal/api/lead-analyzer")],
  ['lead analyzer UI requires explicit selection', files.analyzerPage.includes('data-lead') && files.analyzerPage.includes('Analyze selected')],
  ['command summary uses bounded snapshot', files.summaryApi.includes('const snapshot=await db.prepare') && files.summaryApi.includes('recent_leads')],
  ['command summary is read-only', files.summaryApi.includes('readOnly:true') && files.summaryApi.includes('Do not mutate anything.')],
  ['copilot links analyzer', files.copilotPage.includes('/internal/leads/analyze')],
  ['state records phase 2 surfaces', files.state.includes('/internal/leads/analyze') && files.state.includes('copilot-summary.js')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log(`\n${checks.length} AI surface checks passed.`);
