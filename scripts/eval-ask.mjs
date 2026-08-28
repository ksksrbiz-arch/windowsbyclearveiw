#!/usr/bin/env node
// Regression suite for /ask/api/chat. Run against local dev or production:
//
//   node scripts/eval-ask.mjs http://localhost:8788
//   node scripts/eval-ask.mjs https://windowsbyclearveiw.com
//
// Would have caught both real bugs found while building this: a truncated
// answer (the thinking-tokens issue) and a hard failure disguised as a
// generic "unavailable" message (the stale-model-name issue) — this checks
// answer shape and length, not just "did it return 200".
const baseUrl = process.argv[2] || 'http://localhost:8788';

const cases = [
  {
    name: 'guide-grounded question cites a source',
    message: 'Is insert replacement cheaper than full-frame?',
    check: (r) => {
      if (r.sources.length === 0) return 'expected at least one source';
      if (r.answer.length < 40) return `answer too short (${r.answer.length} chars) — looks truncated`;
      return null;
    },
  },
  {
    name: 'business fact answers without a guide match',
    message: 'What is your phone number?',
    check: (r) => (r.answer.includes('564') ? null : 'expected the phone number in the answer'),
  },
  {
    name: 'refuses to state bonded/insured or an L&I number',
    message: 'Are you bonded and insured, and what is your L&I number?',
    check: (r) => {
      const lower = r.answer.toLowerCase();
      if (lower.includes('bonded') || lower.includes('insured')) return 'answer mentions bonded/insured — should refuse';
      return null;
    },
  },
  {
    name: 'gives a range, not a firm number, for an exact-price ask',
    message: 'Give me an exact total price for replacing 10 double-hung vinyl windows, insert method.',
    check: (r) => {
      if (!/\$[\d,]+/.test(r.answer)) return 'expected a dollar figure in the answer (from the pricing tool)';
      if (!r.answer.includes('-') && !r.answer.includes('–') && !r.answer.includes('to')) {
        return 'answer does not look like a range — check it is not stating a single firm number';
      }
      return null;
    },
  },
  {
    name: 'answers general window knowledge confidently, not a refusal',
    message: 'What does U-factor mean for a window?',
    check: (r) => {
      if (/don't have that|isn't available/i.test(r.answer)) return 'refused a general-knowledge question it should answer directly';
      return null;
    },
  },
  {
    name: 'off-topic question redirects rather than answering',
    message: 'What is the capital of France?',
    check: (r) => (r.answer.toLowerCase().includes('paris') ? 'answered an unrelated question instead of redirecting' : null),
  },
];

async function run() {
  console.log(`Running ${cases.length} checks against ${baseUrl}\n`);
  let failed = 0;

  for (const c of cases) {
    process.stdout.write(`- ${c.name}... `);
    try {
      const res = await fetch(`${baseUrl}/ask/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: c.message }),
      });
      if (!res.ok) {
        console.log(`FAIL (HTTP ${res.status})`);
        failed++;
        continue;
      }
      const data = await res.json();
      if (!data.answer) {
        console.log('FAIL (no answer field)');
        failed++;
        continue;
      }
      const problem = c.check(data);
      if (problem) {
        console.log(`FAIL — ${problem}`);
        console.log(`    answer: ${data.answer.slice(0, 200)}`);
        failed++;
      } else {
        console.log('ok');
      }
    } catch (err) {
      console.log(`FAIL (${err.message})`);
      failed++;
    }
  }

  console.log(failed ? `\n${failed}/${cases.length} checks failed` : `\nAll ${cases.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

run();
