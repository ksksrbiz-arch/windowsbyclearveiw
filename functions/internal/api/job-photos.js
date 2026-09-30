// Job photos in Cloudflare R2. The internal session middleware already requires a login for
// everything under /internal, and the bucket is private, so a photo can only be seen by
// someone signed in to the Command Center.
//
//   GET    ?jobId=J-...           list (works even before R2 is connected: { configured: false })
//   GET    ?id=<photo id>         the image bytes
//   POST   ?jobId&stage&opening&clientId&name&takenAt   body = the image (JPEG, PNG or WebP)
//   PATCH  ?id=<photo id>         { note }
//   DELETE ?id=<photo id>
//
// Until the JOB_PHOTOS R2 binding exists (Pages dashboard, see internal/README.md), uploads answer
// 503 PHOTO_STORAGE_NOT_CONFIGURED and the phone keeps photos locally and retries later.

import { ensureJobsSchema } from '../_lib/jobs-schema.mjs';
import {
  MAX_PHOTO_BYTES,
  cleanName,
  cleanNote,
  ensurePhotoSchema,
  parseClientId,
  parseJobId,
  parseOpening,
  parseStage,
  parseTakenAt,
  photoKey,
  publicPhoto,
  sniffImage,
} from '../_lib/job-photos.mjs';

const NO_STORE = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE } });
}

const notConfigured = () => json({ error: 'Cloud photo storage is not connected yet. Photos stay on this phone until it is.', code: 'PHOTO_STORAGE_NOT_CONFIGURED' }, 503);

function crossOrigin(request) {
  const origin = request.headers.get('origin');
  return Boolean(origin) && origin !== new URL(request.url).origin;
}

const byId = (db, id) => db.prepare('SELECT * FROM job_photos WHERE id = ?').bind(id).first();

export async function onRequestGet({ request, env }) {
  const db = env.QUOTES_DB;
  await ensurePhotoSchema(db);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (id) {
    if (!env.JOB_PHOTOS) return notConfigured();
    const row = await byId(db, id);
    if (!row) return json({ error: 'Photo not found.' }, 404);
    const object = await env.JOB_PHOTOS.get(row.r2_key);
    if (!object) return json({ error: 'The photo file is missing from storage.' }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': row.mime,
        'content-length': String(row.bytes),
        'content-disposition': `inline; filename="${cleanName(row.name)}"`,
        // The file is an image we sniffed, but treat it as untrusted: nothing in it may run or load.
        'content-security-policy': "default-src 'none'; sandbox",
        ...NO_STORE,
      },
    });
  }

  const jobId = parseJobId(url.searchParams.get('jobId'));
  if (!jobId) return json({ error: 'A job id is required.' }, 400);
  const { results } = await db.prepare('SELECT * FROM job_photos WHERE job_id = ? ORDER BY created_at DESC LIMIT 500').bind(jobId).all();
  return json({ configured: Boolean(env.JOB_PHOTOS), photos: (results || []).map(publicPhoto) });
}

export async function onRequestPost({ request, env }) {
  if (crossOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  if (!env.JOB_PHOTOS) return notConfigured();
  const db = env.QUOTES_DB;
  await ensurePhotoSchema(db);
  await ensureJobsSchema(db);

  const url = new URL(request.url);
  const jobId = parseJobId(url.searchParams.get('jobId'));
  const stage = parseStage(url.searchParams.get('stage'));
  const opening = parseOpening(url.searchParams.get('opening'));
  const clientId = parseClientId(url.searchParams.get('clientId'));
  if (!jobId) return json({ error: 'A job id is required.' }, 400);
  if (!stage) return json({ error: 'Stage must be before, during, after or issue.' }, 400);
  if (opening.error) return json({ error: opening.error }, 400);

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) return json({ error: 'That photo is too large.', code: 'PHOTO_TOO_LARGE' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: 'The photo was empty.' }, 400);
  if (bytes.length > MAX_PHOTO_BYTES) return json({ error: 'That photo is too large.', code: 'PHOTO_TOO_LARGE' }, 413);
  const kind = sniffImage(bytes);
  if (!kind) return json({ error: 'Only JPEG, PNG or WebP photos can be saved.', code: 'PHOTO_TYPE_UNSUPPORTED' }, 415);

  const job = await db.prepare('SELECT id FROM jobs WHERE id = ?').bind(jobId).first();
  if (!job) return json({ error: 'Job not found.' }, 404);

  // A retry after a dropped connection must not create a second copy.
  if (clientId) {
    const existing = await db.prepare('SELECT id, job_id FROM job_photos WHERE client_id = ?').bind(clientId).first();
    if (existing) return existing.job_id === jobId ? json({ id: existing.id, existing: true }) : json({ error: 'That photo id belongs to another job.' }, 409);
  }

  const id = crypto.randomUUID();
  const key = photoKey(jobId, id, kind.ext);
  await env.JOB_PHOTOS.put(key, bytes, { httpMetadata: { contentType: kind.mime }, customMetadata: { jobId, stage } });
  try {
    await db
      .prepare('INSERT INTO job_photos (id, job_id, opening_index, stage, name, mime, bytes, r2_key, note, client_id, taken_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, jobId, opening.value, stage, cleanName(url.searchParams.get('name')), kind.mime, bytes.length, key, '', clientId, parseTakenAt(url.searchParams.get('takenAt')), new Date().toISOString())
      .run();
  } catch (error) {
    // Do not leave an unreferenced file behind. If two retries raced, hand back the winner.
    await env.JOB_PHOTOS.delete(key).catch(() => {});
    const winner = clientId ? await db.prepare('SELECT id FROM job_photos WHERE client_id = ?').bind(clientId).first() : null;
    if (winner) return json({ id: winner.id, existing: true });
    console.error('job-photo-insert-failed', error?.message || error);
    return json({ error: 'Could not record the photo. Try again.' }, 500);
  }
  return json({ id, bytes: bytes.length, mime: kind.mime }, 201);
}

export async function onRequestPatch({ request, env }) {
  if (crossOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  const db = env.QUOTES_DB;
  await ensurePhotoSchema(db);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'A photo id is required.' }, 400);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send a JSON body.' }, 400); }
  if (typeof body?.note !== 'string') return json({ error: 'A note is required.' }, 400);
  const result = await db.prepare('UPDATE job_photos SET note = ? WHERE id = ?').bind(cleanNote(body.note), id).run();
  if (!result.meta?.changes) return json({ error: 'Photo not found.' }, 404);
  return json({ ok: true });
}

export async function onRequestDelete({ request, env }) {
  if (crossOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  const db = env.QUOTES_DB;
  await ensurePhotoSchema(db);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'A photo id is required.' }, 400);
  const row = await byId(db, id);
  if (!row) return json({ ok: true, existing: false });
  if (!env.JOB_PHOTOS) return notConfigured();
  // File first: if storage fails the row stays, so the photo is never lost from view while it still exists.
  try {
    await env.JOB_PHOTOS.delete(row.r2_key);
  } catch (error) {
    console.error('job-photo-delete-failed', error?.message || error);
    return json({ error: 'Could not delete the photo from storage. Try again.' }, 502);
  }
  await db.prepare('DELETE FROM job_photos WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
