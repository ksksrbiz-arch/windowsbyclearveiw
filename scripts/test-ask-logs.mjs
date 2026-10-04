// /ask conversation log: what is stored, what is scrubbed, and the 30-day window.
// Real SQLite for D1; no network. Covers the scrubber, the insert-then-purge write path, the
// internal read route, the nightly worker purge and the backup exclusion, and ties the privacy
// policy to the code (the policy says it is written against what the site does).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createD1 } from './_lib/d1-sqlite.mjs';
import { ASK_LOG_RETENTION_DAYS, askLogCutoff, recordAskTurn, scrubForLog } from '../functions/ask/_lib/log-scrub.mjs';
import { onRequestGet } from '../functions/internal/api/ask-logs.js';
import { dumpDatabase, BACKUP_TEXT_PLACEHOLDER } from '../workers/ops-cron/src/backup.mjs';
import { purgeAskLogs } from '../workers/ops-cron/src/index.js';

process.removeAllListeners('warning');
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, 'utf8');
const DAY = 24 * 60 * 60 * 1000;
let groups = 0;
const ok = async (fn) => { await fn(); groups++; };
const freshDb = () => createD1({ schemaFiles: ['functions/ask/_data/schema.sql'] });
const turn = (overrides = {}) => ({ question: 'How much for a slider?', answer: 'Sliders run about $X.', modelUsed: 'groq', toolsUsed: ['estimate_price'], sources: [{ title: 'Guide' }], matchCount: 2, refused: false, ...overrides });

// A database that has never seen /ask has no ask_logs table: the page must load empty, not 500.
await ok(async () => {
  const bare = createD1({ schemaFiles: [] });
  const res = await onRequestGet({ env: { QUOTES_DB: bare } });
  assert.equal(res.status, 200, 'no table yet is an empty page, not a 500');
  const body = await res.json();
  assert.deepEqual(body.logs, []);
  assert.equal(body.funnel.conversations, 0);
});

await ok(async () => {
  assert.equal(ASK_LOG_RETENTION_DAYS, 30);
  const now = Date.parse('2026-10-03T12:00:00Z');
  assert.equal(askLogCutoff(now), '2026-09-03T12:00:00.000Z');
});

await ok(async () => {
  const cases = [
    ['Call me at (360) 555-0142 please', 'Call me at [phone] please'],
    ['my number is 360.555.0142', 'my number is [phone]'],
    ['+1 360-555-0142', '[phone]'],
    ['reach me 555-0142', 'reach me [phone]'],
    ['email jane.doe+win@example.com about it', 'email [email] about it'],
    ['see https://example.com/photo?id=1 and www.example.org/x', 'see [link] and [link]'],
    ['I live at 1234 NE Hawthorne Blvd in Camas', 'I live at [address] in Camas'],
    ['it is 56 Oak Street.', 'it is [address]'],
    ['PO Box 1234', '[address]'],
    ['Camas, WA 98607', 'Camas, WA [zip]'],
    ['Portland OR 97201-1234', 'Portland OR [zip]'],
    ['my zip code is 98607', 'my zip code is [zip]'],
    ['card 4111 1111 1111 1111', 'card [number]'],
    ['ssn 123-45-6789', 'ssn [number]'],
    ['My name is Jane Q Public and I need windows', 'My name is [name] and I need windows'],
    ["I'm Mark, replacing 3 windows", "I'm [name], replacing 3 windows"],
  ];
  for (const [input, expected] of cases) assert.equal(scrubForLog(input, 500), expected, input);

  // Ordinary window talk is left alone: sizes, counts, prices, "way", "place".
  for (const keep of [
    'I need 2 windows by the way',
    'replace 36 inches wide way too drafty',
    'a 36x48 slider, about $12000 total',
    'I have 12 double-hung windows, 1985 build',
    'does a 6 foot patio door cost more than 10 windows in place',
    'quote for 3 openings, 2 sliders',
  ]) assert.equal(scrubForLog(keep, 500), keep, `kept: ${keep}`);

  assert.equal(scrubForLog('  line one\n\n\tline   two\u0000  ', 500), 'line one line two', 'control characters and whitespace collapse');
  assert.equal(scrubForLog(null, 10), '');
  const long = scrubForLog('x '.repeat(400), 100);
  assert.ok(long.length <= 100 && long.endsWith('…'), 'capped with an ellipsis');
});

await ok(async () => {
  const db = freshDb();
  const now = Date.parse('2026-10-03T12:00:00Z');
  await recordAskTurn(db, turn({ question: 'Call me 360-555-0142 about my windows', answer: 'Sure — I cannot call, but the estimate form can.' }), now);
  const row = db.raw.prepare('SELECT * FROM ask_logs').get();
  assert.equal(row.question, 'Call me [phone] about my windows', 'the question is stored, scrubbed');
  assert.equal(row.answer, 'Sure — I cannot call, but the estimate form can.');
  assert.equal(row.created_at, '2026-10-03T12:00:00.000Z');
  assert.deepEqual([JSON.parse(row.tools_used), JSON.parse(row.sources).length, row.match_count, row.refused], [['estimate_price'], 1, 2, 0]);
  assert.ok(!row.question.includes('[redacted]'));

  // Scrubbing also covers the answer, which tends to echo the question.
  await recordAskTurn(db, turn({ answer: 'Email you at pat@example.com? Better to use the form.' }), now + 1000);
  assert.ok(!db.raw.prepare('SELECT answer FROM ask_logs ORDER BY id DESC LIMIT 1').get().answer.includes('pat@example.com'));
});

await ok(async () => {
  // Every insert deletes what is past 30 days; the boundary is exact.
  const db = freshDb();
  const now = Date.parse('2026-10-03T12:00:00Z');
  const put = (iso, q) => db.raw.prepare("INSERT INTO ask_logs (created_at, question, answer, model_used) VALUES (?, ?, 'a', 'm')").run(iso, q);
  put(new Date(now - 31 * DAY).toISOString(), 'old');
  put(new Date(now - 30 * DAY - 1000).toISOString(), 'just expired');
  put(new Date(now - 30 * DAY).toISOString(), 'on the line');
  put(new Date(now - 29 * DAY).toISOString(), 'recent');
  await recordAskTurn(db, turn({ question: 'new' }), now);
  assert.deepEqual(db.raw.prepare('SELECT question FROM ask_logs ORDER BY created_at').all().map((r) => r.question), ['on the line', 'recent', 'new']);
});

await ok(async () => {
  // Logging never costs the visitor their answer: a missing table or binding is swallowed.
  const quiet = console.error; console.error = () => {};
  try {
    await recordAskTurn(createD1(), turn());
    await recordAskTurn(undefined, turn());
  } finally { console.error = quiet; }
});

await ok(async () => {
  // The internal read route hides expired rows even if nothing has purged them, and deletes them.
  const db = freshDb();
  const insert = db.raw.prepare("INSERT INTO ask_logs (created_at, question, answer, model_used) VALUES (?, ?, 'a', 'm')");
  insert.run(new Date(Date.now() - 45 * DAY).toISOString(), 'expired');
  insert.run(new Date(Date.now() - 1 * DAY).toISOString(), 'fresh');
  insert.run(new Date(Date.now() - 2 * DAY).toISOString(), '[redacted]');
  const { logs, funnel } = await (await onRequestGet({ env: { QUOTES_DB: db } })).json();
  assert.deepEqual(logs.map((l) => l.question), ['fresh', '[redacted]']);
  assert.equal(funnel.conversations, 2);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM ask_logs').get().n, 2, 'the expired row is gone from the table');
});

await ok(async () => {
  // Nightly worker: purge, and the backup keeps counts but not the words.
  const db = freshDb();
  const now = new Date('2026-10-03T10:15:00Z');
  const insert = db.raw.prepare("INSERT INTO ask_logs (created_at, question, answer, model_used) VALUES (?, ?, ?, 'm')");
  insert.run(new Date(now.getTime() - 40 * DAY).toISOString(), 'expired q', 'expired a');
  insert.run(new Date(now.getTime() - 2 * DAY).toISOString(), 'secret question', 'secret answer');
  assert.equal(await purgeAskLogs(db, now), 1);
  assert.equal(await purgeAskLogs(db, now), 0);
  const dump = await dumpDatabase(db, now);
  const rows = dump.tables.ask_logs.rows;
  assert.equal(rows.length, 1, 'the row is still counted in the backup');
  assert.equal(rows[0].question, BACKUP_TEXT_PLACEHOLDER);
  assert.equal(rows[0].answer, BACKUP_TEXT_PLACEHOLDER);
  assert.equal(rows[0].model_used, 'm');
  assert.ok(!JSON.stringify(dump).includes('secret'), 'no conversation text reaches the backup file');
  assert.equal(db.raw.prepare('SELECT question FROM ask_logs').get().question, 'secret question', 'the live row is untouched by the backup');
  const quiet = console.error; console.error = () => {};
  try { assert.equal(await purgeAskLogs(createD1(), now), 0, 'a database without the table is not an error'); } finally { console.error = quiet; }
});

await ok(async () => {
  // The code paths that write the log all go through the shared writer, and the visitor-facing
  // promises match what the code does.
  const chat = read('functions/ask/api/chat.js');
  assert.ok(/recordAskTurn\(env\.QUOTES_DB,entry\)/.test(chat) && /logInteraction\(env,\{question:message,answer,/.test(chat), 'chat.js logs the question and answer through recordAskTurn');
  assert.ok(!chat.includes("'[redacted]'"), 'chat.js no longer writes the placeholder');
  assert.ok(read('workers/ops-cron/src/index.js').includes('purgeAskLogs(env.QUOTES_DB, now)'), 'the nightly job purges');

  const privacy = read('src/content/legal/privacy.md');
  for (const phrase of ['30 days', 'phone numbers, email', 'best effort', 'backup']) {
    assert.ok(privacy.includes(phrase), `privacy policy does not say: ${phrase}`);
  }
  assert.ok(!privacy.includes('None of the words from your conversation are stored'), 'the old "nothing stored" claim is gone');
  assert.ok(!/do not keep a copy of your messages/i.test(privacy), 'the old "no copy" claim is gone');
  assert.match(privacy, /updated: 2026-10-03/, 'the policy carries today\'s date');
});

console.log(`ask logs: ok (${groups} groups)`);
