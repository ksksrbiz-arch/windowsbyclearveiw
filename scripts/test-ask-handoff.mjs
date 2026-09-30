// Checks the /ask hand-off to a person: the pure helpers, the hand-off counter
// endpoint, the funnel in the internal Ask page, and the contracts that tie
// the pieces together (estimate-form prefill keys, the lead role, the phone
// pattern). No network and no real database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const load = (path) => import(`${pathToFileURL(`${root}${path}`).href}?t=${Math.random()}`);

let checks = 0;
const ok = (fn) => {
  fn();
  checks++;
};

// ── Helpers ────────────────────────────────────────────────────────────────
const lib = await load('src/lib/ask-handoff.ts');

ok(() => assert.equal(lib.buildEstimateQuery({}), ''));
ok(() => assert.equal(lib.buildEstimateQuery({ homeType: '  ', count: '' }), ''));
ok(() => {
  const query = lib.buildEstimateQuery({
    homeType: 'Existing home',
    count: '2–5',
    openingType: 'slider',
    concern: 'Fogged glass',
    projectStage: 'Planning',
  });
  const params = new URLSearchParams(query);
  assert.ok(query.startsWith('?'));
  assert.deepEqual([...params.keys()], ['home_type', 'openings', 'opening_type', 'concern', 'stage']);
  assert.equal(params.get('openings'), '2–5');
  assert.equal(params.get('concern'), 'Fogged glass');
});
ok(() => {
  // Values are data, never markup or query syntax.
  const params = new URLSearchParams(lib.buildEstimateQuery({ concern: 'a&b=c #x' }));
  assert.equal(params.get('concern'), 'a&b=c #x');
  assert.equal(lib.buildEstimateQuery({ concern: 'x'.repeat(500) }).length < 200, true);
});

// Every query key the helper writes must be one the estimate form reads.
ok(() => {
  const form = read('src/components/EstimateForm.astro');
  for (const key of ['home_type', 'openings', 'opening_type', 'concern', 'stage']) {
    assert.ok(form.includes(`params.get('${key}')`), `EstimateForm does not read "${key}"`);
    assert.ok(new URLSearchParams(lib.buildEstimateQuery({ homeType: 'a', count: 'a', openingType: 'a', concern: 'a', projectStage: 'a' })).has(key));
  }
});

ok(() => assert.equal(lib.buildLeadNotes({}, []), ''));
ok(() => {
  const notes = lib.buildLeadNotes(
    { homeType: 'Existing home', concern: 'Drafts' },
    [
      { role: 'user', content: 'Why is it drafty?' },
      { role: 'assistant', content: 'SECRET assistant text' },
      { role: 'user', content: '  what   would it\ncost  ' },
    ],
  );
  assert.equal(
    notes,
    'Home type: Existing home\nMain concern: Drafts\n\nAsked the website consultant:\n- Why is it drafty?\n- what would it cost',
  );
  assert.ok(!notes.includes('SECRET'));
});
ok(() => {
  const many = Array.from({ length: 9 }, (_, i) => ({ role: 'user', content: `question ${i + 1}` }));
  const lines = lib.buildLeadNotes({}, many).split('\n').filter((l) => l.startsWith('- '));
  assert.deepEqual(lines, ['- question 5', '- question 6', '- question 7', '- question 8', '- question 9']);
});
ok(() => {
  const long = lib.buildLeadNotes({}, [{ role: 'user', content: 'é'.repeat(400) }]);
  const line = long.split('\n').find((l) => l.startsWith('- '));
  assert.ok(line.length <= 162 && line.endsWith('…'));
});
ok(() => {
  const capped = lib.buildLeadNotes({ homeType: 'x'.repeat(80) }, Array.from({ length: 5 }, () => ({ role: 'user', content: 'q'.repeat(400) })), 120);
  assert.ok(capped.length <= 120 && capped.endsWith('…'));
  assert.ok(lib.buildLeadNotes({}, Array.from({ length: 5 }, () => ({ role: 'user', content: 'q'.repeat(400) }))).length <= lib.LEAD_NOTES_MAX);
  assert.ok(lib.LEAD_NOTES_MAX < 2000, 'must fit under the /api/estimate notes limit');
});
ok(() => {
  for (const kind of lib.HANDOFF_KINDS) assert.equal(lib.isHandoffKind(kind), true);
  for (const bad of ['', 'Estimate', 'other', null, undefined, 3, {}]) assert.equal(lib.isHandoffKind(bad), false);
});

// ── Hand-off counter endpoint ──────────────────────────────────────────────
function fakeDb({ failInsert = false, failSchema = 0 } = {}) {
  const calls = { batch: 0, inserts: [] };
  return {
    calls,
    prepare(sql) {
      return {
        sql,
        bind: (...args) => ({
          run: async () => {
            if (failInsert) throw new Error('insert failed');
            calls.inserts.push(args);
          },
        }),
      };
    },
    batch: async (statements) => {
      calls.batch++;
      if (calls.batch <= failSchema) throw new Error('schema failed');
      assert.ok(statements.every((s) => /CREATE (TABLE|INDEX) IF NOT EXISTS ask_handoffs/.test(s.sql)));
    },
  };
}
const post = (handler, body, env) =>
  handler({ request: new Request('https://example.com/ask/api/handoff', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env });

{
  const { onRequestPost } = await load('functions/ask/api/handoff.js');

  const db = fakeDb();
  const res = await post(onRequestPost, { kind: 'estimate' }, { QUOTES_DB: db });
  assert.equal(res.status, 204);
  assert.equal(db.calls.inserts.length, 1);
  assert.equal(db.calls.inserts[0][1], 'estimate');
  assert.ok(!Number.isNaN(Date.parse(db.calls.inserts[0][0])));
  checks++;

  await post(onRequestPost, { kind: 'call' }, { QUOTES_DB: db });
  assert.equal(db.calls.batch, 1, 'schema is created once per isolate, not per request');
  assert.equal(db.calls.inserts.length, 2);
  checks++;

  for (const bad of [{ kind: 'nope' }, { kind: 7 }, {}, []]) {
    const r = await post(onRequestPost, bad, { QUOTES_DB: db });
    assert.equal(r.status, 400);
  }
  assert.equal((await post(onRequestPost, 'not json', { QUOTES_DB: db })).status, 400);
  assert.equal((await post(onRequestPost, { kind: 'call', pad: 'x'.repeat(2000) }, { QUOTES_DB: db })).status, 413);
  assert.equal(db.calls.inserts.length, 2, 'rejected requests write nothing');
  checks++;

  // Measurement never blocks the visitor.
  assert.equal((await post(onRequestPost, { kind: 'call' }, {})).status, 204);
  checks++;
}
{
  const { onRequestPost } = await load('functions/ask/api/handoff.js');
  const originalError = console.error;
  console.error = () => {};
  try {
    const failing = fakeDb({ failInsert: true });
    assert.equal((await post(onRequestPost, { kind: 'call' }, { QUOTES_DB: failing })).status, 204);
    const flaky = fakeDb({ failSchema: 1 });
    assert.equal((await post(onRequestPost, { kind: 'call' }, { QUOTES_DB: flaky })).status, 204);
    assert.equal((await post(onRequestPost, { kind: 'call' }, { QUOTES_DB: flaky })).status, 204);
    assert.equal(flaky.calls.batch, 2, 'a failed schema step is retried on the next request');
    assert.equal(flaky.calls.inserts.length, 1);
  } finally {
    console.error = originalError;
  }
  checks++;
}

// ── Funnel in the internal Ask page ────────────────────────────────────────
{
  const { onRequestGet } = await load('functions/internal/api/ask-logs.js');
  const answers = { ask_logs: 40, "kind = 'estimate'": 6, "kind = 'call'": 3, "kind = 'callback_open'": 4, "role = 'Ask assistant'": 2 };
  const env = {
    QUOTES_DB: {
      prepare(sql) {
        const listing = /SELECT id, created_at/.test(sql);
        const n = Object.entries(answers).find(([needle]) => sql.includes(needle))?.[1] ?? 0;
        return {
          all: async () => ({ results: listing ? [{ id: 1 }] : [] }),
          bind: () => ({ first: async () => ({ n }) }),
        };
      },
    },
  };
  const body = await (await onRequestGet({ env })).json();
  assert.deepEqual(body.funnel, { days: 30, conversations: 40, estimate: 6, call: 3, callbackOpen: 4, callbackLeads: 2 });
  assert.equal(body.logs.length, 1);
  checks++;

  // A table that does not exist yet reads as zero instead of failing the page.
  const missing = {
    QUOTES_DB: {
      prepare: (sql) => ({
        all: async () => ({ results: [] }),
        bind: () => ({
          first: async () => {
            if (/ask_handoffs|leads/.test(sql)) throw new Error('no such table');
            return { n: 5 };
          },
        }),
      }),
    },
  };
  const partial = (await (await onRequestGet({ env: missing })).json()).funnel;
  assert.equal(partial.conversations, 5);
  assert.equal(partial.estimate + partial.call + partial.callbackOpen + partial.callbackLeads, 0);
  checks++;
}

// ── Contracts between the files ────────────────────────────────────────────
{
  const page = read('src/pages/ask.astro');
  const script = read('src/scripts/ask-callback.ts');
  const form = read('src/components/EstimateForm.astro');

  // The lead role is written by the client and counted by the server.
  const clientRole = /const LEAD_ROLE = '([^']+)'/.exec(script)?.[1];
  assert.ok(clientRole, 'LEAD_ROLE not found');
  assert.ok(read('functions/internal/api/ask-logs.js').includes(`role = '${clientRole}'`), 'funnel does not count the role the client sends');
  assert.ok(clientRole.length <= 40, 'role is truncated at 40 characters by /api/estimate');
  checks++;

  // Hooks the script relies on exist in the page, exactly once where it matters.
  for (const hook of ['data-ask-callback', 'data-callback-form', 'data-callback-submit', 'data-callback-success', 'data-callback-status', 'data-ask-callback-open', 'data-ask-handoff-link']) {
    assert.ok(page.includes(hook), `ask.astro is missing ${hook}`);
    assert.ok(script.includes(hook.replace(/^data-/, '')) || script.includes(hook), `ask-callback.ts does not use ${hook}`);
  }
  assert.equal((page.match(/data-ask-track="estimate"/g) || []).length, 1);
  assert.equal((page.match(/data-ask-track="call"/g) || []).length, 1);
  checks++;

  // Same phone rule as the estimate form, and it must compile under the `v` flag browsers use.
  const pattern = (html) => /name="phone"[^>]*\spattern="([^"]+)"/.exec(html)?.[1];
  const dialogPattern = pattern(page);
  assert.ok(dialogPattern, 'call-back phone input has no pattern');
  assert.equal(dialogPattern, pattern(form));
  assert.doesNotThrow(() => new RegExp(`^(?:${dialogPattern})$`, 'v'));
  checks++;

  // It posts to the same lead endpoint and reuses the same success event as the form.
  assert.ok(script.includes("'/api/estimate'") && form.includes("'/api/estimate'"));
  assert.ok(script.includes("event: 'generate_lead'") && form.includes("event: 'generate_lead'"));
  // No timing or room-state promises in the confirmation (owner rule).
  assert.ok(!/same day|within \d|usable/i.test(page.match(/<dialog[\s\S]*?<\/dialog>/)?.[0] || ''));
  checks++;
}

console.log(`ask hand-off: ok (${checks} groups)`);
