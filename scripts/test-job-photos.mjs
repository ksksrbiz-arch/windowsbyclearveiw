// Job photos in R2: the validators, and the real endpoint on real SQLite with an in-memory
// stand-in for the R2 bucket. No network.
import assert from 'node:assert/strict';
import { createD1 } from './_lib/d1-sqlite.mjs';
import {
  MAX_PHOTO_BYTES,
  cleanName,
  cleanNote,
  parseClientId,
  parseJobId,
  parseOpening,
  parseStage,
  parseTakenAt,
  photoKey,
  sniffImage,
} from '../functions/internal/_lib/job-photos.mjs';
import * as photosApi from '../functions/internal/api/job-photos.js';
import * as jobsApi from '../functions/internal/api/jobs.js';

const pass = (message) => console.log(`PASS: ${message}`);
const ORIGIN = 'https://x.test';

// ── Pure validation ────────────────────────────────────────────────────────
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const WEBP = new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)), [0x56, 0x50, 0x38, 0x20]));
const text = (value) => new TextEncoder().encode(value);
{
  assert.deepEqual(sniffImage(JPEG), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(sniffImage(PNG), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(sniffImage(WEBP), { mime: 'image/webp', ext: 'webp' });
  for (const [name, bytes] of [
    ['svg', text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['html', text('<!doctype html><script>alert(1)</script>')],
    ['gif', text('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000')],
    ['pdf', text('%PDF-1.7\n1 0 obj')],
    ['heic', new Uint8Array([0, 0, 0, 0x18, ...text('ftypheic'), 0, 0, 0, 0])],
    ['riff but not webp', text('RIFF\u0000\u0000\u0000\u0000WAVEfmt ')],
    ['too short', new Uint8Array([0xff, 0xd8, 0xff])],
    ['empty', new Uint8Array(0)],
  ]) assert.equal(sniffImage(bytes), null, `${name} is not accepted`);
  assert.equal(sniffImage('not bytes'), null);

  assert.deepEqual(parseOpening(''), { value: null });
  assert.deepEqual(parseOpening(undefined), { value: null });
  assert.deepEqual(parseOpening('3'), { value: 3 });
  for (const bad of ['0', '-1', '1.5', 'abc', '99999', '1e2', ' ']) assert.ok(parseOpening(bad).error, `opening "${bad}" is refused`);

  assert.equal(parseStage('before'), 'before');
  for (const bad of ['Before', 'x', '', null, undefined]) assert.equal(parseStage(bad), null);
  assert.equal(parseJobId(' J-20260930-ABCD '), 'J-20260930-ABCD');
  for (const bad of ['', 'Q-1', 'J-', '../J-1', 'J-1/../../x', 'J-ab cd', null]) assert.equal(parseJobId(bad), null, `job id ${String(bad)}`);
  assert.equal(parseClientId('3f2a9c1e-1b7d-4c55-9f7e-0a1b2c3d4e5f'), '3f2a9c1e-1b7d-4c55-9f7e-0a1b2c3d4e5f');
  for (const bad of ['short', 'has space in it!!', 'x'.repeat(65), null]) assert.equal(parseClientId(bad), null);
  assert.equal(cleanName('../../etc/passwd'), 'passwd');
  assert.equal(cleanName('C:\\Users\\Mark\\IMG_1.jpg'), 'IMG_1.jpg');
  assert.equal(cleanName('a"b;c\nd.jpg'), 'abcd.jpg', 'quotes, semicolons and control characters are dropped');
  assert.equal(cleanName(''), 'photo');
  assert.equal(cleanName(undefined), 'photo');
  assert.equal(cleanName('x'.repeat(300)).length, 120);
  assert.equal(cleanNote('  hi  '), 'hi');
  assert.equal(cleanNote('x'.repeat(900)).length, 500);
  assert.equal(cleanNote(42), '');
  assert.equal(parseTakenAt('2026-09-30T18:00:00Z'), '2026-09-30T18:00:00.000Z');
  for (const bad of ['yesterday', '1999-01-01', '2999-01-01', '', null]) assert.equal(parseTakenAt(bad), null);
  assert.equal(photoKey('J-1', 'abc', 'jpg'), 'jobs/J-1/abc.jpg');
  pass('validation: file types sniffed from bytes, ids, opening, stage, names, notes, dates');
}

// ── An in-memory R2 ────────────────────────────────────────────────────────
function fakeBucket({ failDelete = false } = {}) {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options) {
      objects.set(key, { bytes: new Uint8Array(value), contentType: options?.httpMetadata?.contentType, meta: options?.customMetadata });
    },
    async get(key) {
      const item = objects.get(key);
      return item ? { body: new Blob([item.bytes]).stream(), httpMetadata: { contentType: item.contentType } } : null;
    },
    async delete(key) {
      if (failDelete) throw new Error('storage unavailable');
      objects.delete(key);
    },
  };
}

async function call(handler, env, { method = 'GET', path = '/', body, headers = {} } = {}) {
  const request = new Request(`${ORIGIN}${path}`, { method, headers, body });
  const response = await handler({ request, env, params: {}, waitUntil() {} });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : new Uint8Array(await response.arrayBuffer()) };
}
const freshEnv = (extra = {}) => ({ QUOTES_DB: createD1({ schemaFiles: ['functions/api/_data/schema.sql', 'internal/db/schema.sql'] }), ...extra });
const makeJob = async (env) => (await call(jobsApi.onRequestPost, env, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workType: 'general', customerName: 'Pat', workDescription: 'Deck', agreedAmount: '100' }) })).body.id;
const upload = (env, query, bytes = JPEG, headers = {}) =>
  call(photosApi.onRequestPost, env, { method: 'POST', path: `/internal/api/job-photos?${new URLSearchParams(query)}`, body: bytes, headers });
const CLIENT = '3f2a9c1e-1b7d-4c55-9f7e-0a1b2c3d4e5f';

// ── Before R2 is connected ─────────────────────────────────────────────────
{
  const env = freshEnv();
  const jobId = await makeJob(env);
  const post = await upload(env, { jobId, stage: 'before', clientId: CLIENT });
  assert.equal(post.status, 503);
  assert.equal(post.body.code, 'PHOTO_STORAGE_NOT_CONFIGURED', 'the phone can tell "not set up yet" from a real failure');
  const list = await call(photosApi.onRequestGet, env, { path: `/internal/api/job-photos?jobId=${jobId}` });
  assert.deepEqual(list.body, { configured: false, photos: [] }, 'listing still works so the page can say so');
  assert.equal((await call(photosApi.onRequestGet, env, { path: '/internal/api/job-photos?id=x' })).status, 503);
  pass('before R2 is connected: uploads answer 503 with a clear code, the list says not configured');
}

// ── Upload, list, read ─────────────────────────────────────────────────────
const bucket = fakeBucket();
const env = freshEnv({ JOB_PHOTOS: bucket });
const jobId = await makeJob(env);
let photoId;
{
  const created = await upload(env, { jobId, stage: 'before', opening: '2', clientId: CLIENT, name: '../../IMG_0001.jpg', takenAt: '2026-09-30T18:00:00Z' });
  assert.equal(created.status, 201);
  photoId = created.body.id;
  assert.equal(created.body.mime, 'image/jpeg');
  const [key] = [...bucket.objects.keys()];
  assert.equal(key, `jobs/${jobId}/${photoId}.jpg`, 'the object key is built from server-made ids, never the file name');
  assert.equal(bucket.objects.get(key).contentType, 'image/jpeg');
  assert.deepEqual([...bucket.objects.get(key).bytes], [...JPEG]);

  const row = env.QUOTES_DB.raw.prepare('SELECT * FROM job_photos WHERE id = ?').get(photoId);
  assert.equal(row.name, 'IMG_0001.jpg');
  assert.equal(row.opening_index, 2);
  assert.equal(row.stage, 'before');
  assert.equal(row.bytes, JPEG.length);
  assert.equal(row.taken_at, '2026-09-30T18:00:00.000Z');

  const list = await call(photosApi.onRequestGet, env, { path: `/internal/api/job-photos?jobId=${jobId}` });
  assert.equal(list.body.configured, true);
  assert.equal(list.body.photos.length, 1);
  assert.equal(JSON.stringify(list.body).includes('r2_key'), false, 'the storage key is never sent to the phone');
  assert.equal(JSON.stringify(list.body).includes('jobs/'), false);
  assert.equal(list.body.photos[0].clientId, CLIENT);

  const file = await call(photosApi.onRequestGet, env, { path: `/internal/api/job-photos?id=${photoId}` });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/jpeg');
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(file.headers.get('content-disposition'), 'inline; filename="IMG_0001.jpg"');
  assert.deepEqual([...file.body], [...JPEG]);
  assert.equal((await call(photosApi.onRequestGet, env, { path: '/internal/api/job-photos?id=nope' })).status, 404);
  assert.equal((await call(photosApi.onRequestGet, env, { path: '/internal/api/job-photos' })).status, 400);
  assert.equal((await call(photosApi.onRequestGet, env, { path: '/internal/api/job-photos?jobId=../x' })).status, 400);
  pass('upload, list (no storage key exposed) and read back with safe headers');
}

// ── Retries, limits, bad input ─────────────────────────────────────────────
{
  const again = await upload(env, { jobId, stage: 'before', opening: '2', clientId: CLIENT });
  assert.equal(again.status, 200);
  assert.equal(again.body.id, photoId, 'a retry returns the same photo');
  assert.equal(bucket.objects.size, 1, 'and stores no second copy');
  env.QUOTES_DB.raw.prepare(`INSERT INTO jobs (id,created_at,updated_at,customer_name) VALUES ('J-OTHER-1','x','x','Other')`).run();
  assert.equal((await upload(env, { jobId: 'J-OTHER-1', stage: 'after', clientId: CLIENT })).status, 409, 'one client id cannot be claimed by two jobs');

  assert.equal((await upload(env, { jobId, stage: 'sideways' })).status, 400);
  assert.equal((await upload(env, { jobId })).status, 400);
  assert.equal((await upload(env, { stage: 'before' })).status, 400);
  assert.equal((await upload(env, { jobId, stage: 'before', opening: '0' })).status, 400);
  assert.equal((await upload(env, { jobId: 'J-MISSING-1', stage: 'before' })).status, 404);
  assert.equal((await upload(env, { jobId, stage: 'before' }, new Uint8Array(0))).status, 400);
  for (const bytes of [text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), text('<!doctype html><script>1</script>'), text('%PDF-1.7 not a photo at all')]) {
    const r = await upload(env, { jobId, stage: 'before' }, bytes);
    assert.equal(r.status, 415);
    assert.equal(r.body.code, 'PHOTO_TYPE_UNSUPPORTED');
  }
  const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
  big.set(JPEG);
  const tooBig = await upload(env, { jobId, stage: 'before' }, big);
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.body.code, 'PHOTO_TOO_LARGE');
  assert.equal((await upload(env, { jobId, stage: 'before' }, JPEG, { origin: 'https://evil.example' })).status, 403, 'cross-origin writes are refused');
  assert.equal(bucket.objects.size, 1, 'nothing rejected left a file behind');
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM job_photos').get().n, 1);
  pass('retries are idempotent; wrong types, sizes, jobs, stages and origins are refused and store nothing');
}

// ── A failed database write leaves no orphan file ──────────────────────────
{
  const b = fakeBucket();
  const e = freshEnv({ JOB_PHOTOS: b });
  const j = await makeJob(e);
  const realPrepare = e.QUOTES_DB.prepare.bind(e.QUOTES_DB);
  e.QUOTES_DB.prepare = (sql) => (/INSERT INTO job_photos/.test(sql) ? { bind: () => ({ run: async () => { throw new Error('disk full'); } }) } : realPrepare(sql));
  const originalError = console.error;
  console.error = () => {};
  try {
    const r = await upload(e, { jobId: j, stage: 'during' });
    assert.equal(r.status, 500);
  } finally {
    console.error = originalError;
  }
  assert.equal(b.objects.size, 0, 'the file was removed when its row could not be saved');
  pass('a failed database write deletes the stored file');
}

// ── Note and delete ────────────────────────────────────────────────────────
{
  const patch = (id, body) => call(photosApi.onRequestPatch, env, { method: 'PATCH', path: `/internal/api/job-photos?id=${id}`, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  assert.equal((await patch(photoId, { note: '  Rotted sill  ' })).status, 200);
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT note FROM job_photos WHERE id = ?').get(photoId).note, 'Rotted sill');
  assert.equal((await patch(photoId, { note: 5 })).status, 400);
  assert.equal((await patch('nope', { note: 'x' })).status, 404);

  // Storage failing must not make the photo disappear from the list.
  const flaky = freshEnv({ JOB_PHOTOS: fakeBucket({ failDelete: true }) });
  const fj = await makeJob(flaky);
  const fid = (await upload(flaky, { jobId: fj, stage: 'after', clientId: 'aaaaaaaa-bbbb-cccc' })).body.id;
  const originalError = console.error;
  console.error = () => {};
  try {
    const failed = await call(photosApi.onRequestDelete, flaky, { method: 'DELETE', path: `/internal/api/job-photos?id=${fid}` });
    assert.equal(failed.status, 502);
  } finally {
    console.error = originalError;
  }
  assert.equal(flaky.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM job_photos').get().n, 1, 'the row stays when the file could not be deleted');

  const del = await call(photosApi.onRequestDelete, env, { method: 'DELETE', path: `/internal/api/job-photos?id=${photoId}` });
  assert.equal(del.status, 200);
  assert.equal(bucket.objects.size, 0);
  assert.equal(env.QUOTES_DB.raw.prepare('SELECT COUNT(*) AS n FROM job_photos').get().n, 0);
  assert.equal((await call(photosApi.onRequestDelete, env, { method: 'DELETE', path: `/internal/api/job-photos?id=${photoId}` })).status, 200, 'deleting twice is fine');
  assert.equal((await call(photosApi.onRequestDelete, env, { method: 'DELETE', path: '/internal/api/job-photos?id=x', headers: { origin: 'https://evil.example' } })).status, 403);
  pass('notes are cleaned, deletes remove file and row, a storage failure keeps the photo listed');
}

console.log('Job photo checks passed.');
