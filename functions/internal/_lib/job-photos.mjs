// Job photos saved to Cloudflare R2 (binding JOB_PHOTOS), with a row per photo in D1.
//
// The bucket is private: nothing is ever public, and every photo is served through the
// authenticated /internal/api/job-photos endpoint. Everything here is deterministic
// validation; the endpoint owns the storage calls.

export const PHOTO_STAGES = Object.freeze(['before', 'during', 'after', 'issue']);
/** Phones compress before uploading (about 0.3-2 MB); this is only a ceiling for anything else. */
export const MAX_PHOTO_BYTES = 8_000_000;
export const MAX_NOTE_CHARS = 500;

const JOB_ID = /^J-[A-Za-z0-9-]{3,40}$/;
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;

export const parseJobId = (value) => (typeof value === 'string' && JOB_ID.test(value.trim()) ? value.trim() : null);
export const parseClientId = (value) => (typeof value === 'string' && CLIENT_ID.test(value.trim()) ? value.trim() : null);
export const parseStage = (value) => (PHOTO_STAGES.includes(value) ? value : null);

/** Opening number: blank means project-wide (null); anything else must be a whole number 1-9999. */
export function parseOpening(value) {
  if (value === undefined || value === null || value === '') return { value: null };
  const text = String(value).trim();
  if (!/^\d{1,4}$/.test(text)) return { error: 'Opening must be a whole number.' };
  const number = Number(text);
  return number >= 1 ? { value: number } : { error: 'Opening must be a whole number of 1 or more.' };
}

export const cleanNote = (value) => (typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, MAX_NOTE_CHARS) : '');

/** A file name for display and for Content-Disposition: no paths, no control characters, no quotes. */
export function cleanName(value) {
  const base = typeof value === 'string' ? value.split(/[\\/]/).pop() : '';
  const cleaned = (base || '').replace(/[\u0000-\u001f\u007f"\\;]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned || 'photo';
}

export function parseTakenAt(value) {
  if (typeof value !== 'string' || !value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) || time > Date.now() + 86_400_000 || time < Date.UTC(2020, 0, 1) ? null : new Date(time).toISOString();
}

/**
 * What the file really is, from its first bytes, never from the name or the header the phone sent.
 * Only formats a browser shows inline and cannot run script: no SVG, no HTML, no HEIC.
 */
export function sniffImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  const tag = (from, text) => [...text].every((char, i) => bytes[from + i] === char.charCodeAt(0));
  if (tag(0, 'RIFF') && tag(8, 'WEBP')) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** Object key: built only from ids the server generated or validated, never from the file name. */
export const photoKey = (jobId, photoId, ext) => `jobs/${jobId}/${photoId}.${ext}`;

export async function ensurePhotoSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS job_photos (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      opening_index INTEGER,
      stage TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      r2_key TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      client_id TEXT UNIQUE,
      taken_at TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id, created_at DESC)'),
  ]);
}

/** The row as the phone sees it: no storage key. */
export function publicPhoto(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    openingIndex: row.opening_index ?? null,
    stage: row.stage,
    name: row.name,
    mime: row.mime,
    bytes: Number(row.bytes) || 0,
    note: row.note || '',
    clientId: row.client_id || null,
    takenAt: row.taken_at || null,
    createdAt: row.created_at,
  };
}
