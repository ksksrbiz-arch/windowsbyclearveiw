// Phone-side photo backup: sizing, the upload request, what counts as "try again later" versus
// "will never work", and the order and stopping rules for uploading a queue. No network, no DOM.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_UPLOAD_BYTES, describeBackup, fitWithin, syncPending, uploadPhoto, uploadUrl } from '../src/lib/photo-sync.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
let groups = 0;
const ok = async (fn) => {
  await fn();
  groups++;
};

const photo = (overrides = {}) => ({
  id: '3f2a9c1e-1b7d-4c55-9f7e-0a1b2c3d4e5f',
  jobId: 'J-20260930-ABCD',
  openingIndex: 2,
  stage: 'before',
  name: 'IMG 0001 & more.jpg',
  mime: 'image/jpeg',
  createdAt: '2026-09-30T18:00:00.000Z',
  note: '',
  blob: new Blob([new Uint8Array(1000)], { type: 'image/jpeg' }),
  ...overrides,
});
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' }, ...extra });
const keep = async (blob) => blob;

await ok(() => {
  assert.deepEqual(fitWithin(1600, 1200), { width: 1600, height: 1200 }, 'already small enough');
  assert.deepEqual(fitWithin(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(3000, 4000), { width: 1500, height: 2000 }, 'portrait photos fit by their long edge');
  assert.deepEqual(fitWithin(10000, 1), { width: 2000, height: 1 }, 'never collapses a side to zero');
  assert.deepEqual(fitWithin(0, 0), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(NaN, 5), { width: NaN, height: 5 });
});

await ok(() => {
  const url = new URL(uploadUrl(photo()), 'https://x.test');
  assert.equal(url.pathname, '/internal/api/job-photos');
  assert.equal(url.searchParams.get('jobId'), 'J-20260930-ABCD');
  assert.equal(url.searchParams.get('stage'), 'before');
  assert.equal(url.searchParams.get('opening'), '2');
  assert.equal(url.searchParams.get('clientId'), '3f2a9c1e-1b7d-4c55-9f7e-0a1b2c3d4e5f', 'the phone-side id makes a retry safe');
  assert.equal(url.searchParams.get('name'), 'IMG 0001 & more.jpg', 'names are encoded, not concatenated');
  assert.equal(url.searchParams.get('takenAt'), '2026-09-30T18:00:00.000Z');
  assert.equal(new URL(uploadUrl(photo({ openingIndex: null })), 'https://x.test').searchParams.has('opening'), false, 'project-wide photos send no opening');
});

await ok(async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    return json(201, { id: 'remote-1' });
  };
  assert.deepEqual(await uploadPhoto(photo(), fakeFetch, keep), { ok: true, id: 'remote-1' });
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['content-type'], 'image/jpeg');
  assert.equal(calls[0].init.credentials, 'same-origin');

  // The compressed copy is what is sent, with its own type.
  const small = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
  await uploadPhoto(photo({ blob: new Blob([new Uint8Array(5000)], { type: 'image/png' }) }), fakeFetch, async () => small);
  assert.equal(calls[1].init.body, small);

  // Already stored (a retry that the server recognised) counts as success.
  assert.deepEqual(await uploadPhoto(photo(), async () => json(200, { id: 'remote-1', existing: true }), keep), { ok: true, id: 'remote-1' });
});

await ok(async () => {
  const fail = async (response, p = photo()) => uploadPhoto(p, async () => response, keep);
  const notConfigured = await fail(json(503, { error: 'Cloud photo storage is not connected yet.', code: 'PHOTO_STORAGE_NOT_CONFIGURED' }));
  assert.equal(notConfigured.ok, false);
  assert.equal(notConfigured.code, 'PHOTO_STORAGE_NOT_CONFIGURED');
  assert.equal(notConfigured.retryable, true, 'storage being connected later is a reason to try again');

  assert.equal((await fail(json(500, { error: 'Try again.' }))).retryable, true, 'server errors are retried later');
  assert.equal((await fail(json(429, {}))).retryable, true);
  assert.equal((await fail(json(408, {}))).retryable, true);
  const wrongType = await fail(json(415, { error: 'Only JPEG, PNG or WebP photos can be saved.', code: 'PHOTO_TYPE_UNSUPPORTED' }));
  assert.equal(wrongType.retryable, false, 'a photo the server refuses is not retried forever');
  assert.equal(wrongType.message, 'Only JPEG, PNG or WebP photos can be saved.');
  assert.equal((await fail(json(404, { error: 'Job not found.' }))).retryable, false);
  assert.equal((await fail(json(400, {}))).message, 'Could not back up this photo.', 'a missing message gets a plain one');

  // Signed out: the server answers with the login page, not JSON.
  const loginPage = new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const signedOut = await fail(loginPage);
  assert.equal(signedOut.retryable, true);
  assert.match(signedOut.message, /Sign in again/);

  const offline = await uploadPhoto(photo(), async () => { throw new TypeError('Failed to fetch'); }, keep);
  assert.equal(offline.retryable, true);
  assert.match(offline.message, /No connection/);

  // Refused before any network call.
  let called = false;
  const never = async () => { called = true; return json(201, { id: 'x' }); };
  const gif = await uploadPhoto(photo({ blob: new Blob([new Uint8Array(10)], { type: 'image/gif' }) }), never, keep);
  assert.equal(gif.retryable, false);
  const huge = await uploadPhoto(photo({ blob: { type: 'image/jpeg', size: MAX_UPLOAD_BYTES + 1 } }), never, keep);
  assert.equal(huge.retryable, false);
  assert.equal(called, false, 'unsendable photos never reach the network');
});

await ok(async () => {
  const log = { uploads: [], marks: [] };
  const deps = (script = {}) => ({
    upload: async (p) => {
      log.uploads.push(p.id);
      return script[p.id] ?? { ok: true, id: `remote-${p.id}` };
    },
    mark: async (id, patch) => { log.marks.push([id, patch]); },
    now: () => 'NOW',
  });
  const a = photo({ id: 'aaaaaaaa-0001', createdAt: '2026-09-30T10:00:00Z' });
  const b = photo({ id: 'bbbbbbbb-0002', createdAt: '2026-09-30T09:00:00Z' });
  const c = photo({ id: 'cccccccc-0003', createdAt: '2026-09-30T11:00:00Z' });

  let summary = await syncPending([a, b, c], deps());
  assert.deepEqual(log.uploads, ['bbbbbbbb-0002', 'aaaaaaaa-0001', 'cccccccc-0003'], 'oldest first');
  assert.equal(summary.uploaded, 3);
  assert.deepEqual(log.marks[0], ['bbbbbbbb-0002', { remoteId: 'remote-bbbbbbbb-0002', uploadedAt: 'NOW', uploadError: undefined }]);

  // Already uploaded, already refused, and job-less photos are left alone.
  log.uploads.length = 0;
  summary = await syncPending([photo({ id: 'dddddddd-0004', remoteId: 'r' }), photo({ id: 'eeeeeeee-0005', uploadError: 'nope' }), photo({ id: 'ffffffff-0006', jobId: '' })], deps());
  assert.deepEqual(log.uploads, []);
  assert.equal(summary.uploaded + summary.failed + summary.waiting, 0);

  // Offline partway: stop at the first retryable failure; the rest wait.
  log.uploads.length = 0;
  log.marks.length = 0;
  summary = await syncPending([a, b, c], deps({ 'aaaaaaaa-0001': { ok: false, retryable: true, message: 'No connection.' } }));
  assert.deepEqual(log.uploads, ['bbbbbbbb-0002', 'aaaaaaaa-0001'], 'stops instead of failing every photo the same way');
  assert.equal(summary.uploaded, 1);
  assert.equal(summary.waiting, 2);
  assert.equal(summary.message, 'No connection.');
  assert.equal(log.marks.length, 1, 'nothing is marked for a retryable failure');

  // One photo the server refuses does not block the others.
  log.uploads.length = 0;
  log.marks.length = 0;
  summary = await syncPending([a, b, c], deps({ 'aaaaaaaa-0001': { ok: false, retryable: false, message: 'Only JPEG.' } }));
  assert.equal(summary.uploaded, 2);
  assert.equal(summary.failed, 1);
  assert.ok(log.marks.some(([id, patch]) => id === 'aaaaaaaa-0001' && patch.uploadError === 'Only JPEG.'));

  // Storage not connected yet: flagged, and nothing else is attempted.
  log.uploads.length = 0;
  summary = await syncPending([a, b, c], deps({ 'bbbbbbbb-0002': { ok: false, retryable: true, code: 'PHOTO_STORAGE_NOT_CONFIGURED', message: 'Not connected.' } }));
  assert.equal(summary.notConfigured, true);
  assert.deepEqual(log.uploads, ['bbbbbbbb-0002']);
  assert.equal(summary.waiting, 3);

  // A thrown error is handled like a failed connection, and the next run still works.
  summary = await syncPending([a], { upload: async () => { throw new Error('boom'); }, mark: async () => {} });
  assert.equal(summary.waiting, 1);
  summary = await syncPending([a], deps());
  assert.equal(summary.uploaded, 1, 'a failed run does not lock later runs out');

  // Two overlapping runs (page load plus the phone coming back online) never upload the same photo twice.
  log.uploads.length = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = { upload: async (p) => { log.uploads.push(p.id); await gate; return { ok: true, id: 'r' }; }, mark: async () => {} };
  const first = syncPending([a], slow);
  const second = await syncPending([a], slow);
  assert.equal(second.uploaded, 0);
  assert.equal(second.waiting, 1);
  release();
  assert.equal((await first).uploaded, 1);
  assert.deepEqual(log.uploads, ['aaaaaaaa-0001']);
});

await ok(() => {
  const done = { remoteId: 'r' };
  assert.equal(describeBackup([]), 'Nothing to back up yet');
  assert.equal(describeBackup([], { notConfigured: true, message: '' }), 'Not connected yet');
  assert.equal(describeBackup([done, done, done]), 'All 3 backed up to the cloud.');
  assert.equal(describeBackup([done, {}, {}]), '1 of 3 backed up. 2 waiting for a connection.');
  assert.equal(describeBackup([done, { uploadError: 'x' }]), '1 of 2 backed up. 1 could not be.');
  assert.equal(describeBackup([{}, {}], { notConfigured: true, message: '' }), 'Not connected yet. Photos stay on this phone.');
  assert.equal(describeBackup([done, done], { notConfigured: true, message: '' }), 'All 2 backed up to the cloud.', 'connected photos are still reported as saved');
});

// The page uses this module, and the server accepts what the phone sends.
await ok(() => {
  const page = readFileSync(`${root}src/pages/internal/tools/photos.astro`, 'utf8');
  for (const name of ['syncPending', 'uploadPhoto', 'describeBackup']) assert.ok(page.includes(name), `the Photos page uses ${name}`);
  assert.ok(page.includes('data-cloud'), 'the page shows the backup state');
  assert.ok(page.includes("addEventListener('online'"), 'uploads resume when the phone comes back online');
  const server = readFileSync(`${root}functions/internal/_lib/job-photos.mjs`, 'utf8');
  assert.ok(server.includes(`MAX_PHOTO_BYTES = ${MAX_UPLOAD_BYTES.toLocaleString('en-US').replace(/,/g, '_')}`), 'the phone and server size limits agree');
});

console.log(`photo sync: ok (${groups} groups)`);
