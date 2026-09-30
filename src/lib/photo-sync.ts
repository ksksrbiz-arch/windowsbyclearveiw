/**
 * Backs up the photos Mark takes on his phone to cloud storage, without ever making the phone
 * the thing that can fail: a photo is saved on the phone first, and uploaded afterwards whenever
 * there is signal and storage is connected. A photo is never removed from the phone because an
 * upload failed.
 *
 * The decisions (what to upload, when to stop, what to tell the user) are pure and take their
 * network and storage as arguments, so scripts/test-photo-sync.mjs can run them in Node. Only
 * erasable TypeScript is used here for that reason. compressImage is the one browser-only piece.
 */

export type LocalPhoto = {
  id: string;
  jobId: string;
  openingIndex: number | null;
  stage: string;
  name: string;
  mime: string;
  createdAt: string;
  note: string;
  blob: Blob;
  remoteId?: string;
  uploadedAt?: string;
  uploadError?: string;
};

/** Long edge after compression. Plenty to read a flashing detail; about 0.3-1.5 MB instead of 5-12 MB. */
export const MAX_EDGE = 2000;
export const JPEG_QUALITY = 0.85;
/** Must match the server's ceiling (functions/internal/_lib/job-photos.mjs). */
export const MAX_UPLOAD_BYTES = 8_000_000;
const ENDPOINT = '/internal/api/job-photos';
const SENDABLE = ['image/jpeg', 'image/png', 'image/webp'];

export function fitWithin(width: number, height: number, maxEdge: number = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!(longest > 0) || longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function uploadUrl(photo: LocalPhoto): string {
  const query = new URLSearchParams({ jobId: photo.jobId, stage: photo.stage, clientId: photo.id, name: photo.name, takenAt: photo.createdAt });
  if (photo.openingIndex) query.set('opening', String(photo.openingIndex));
  return `${ENDPOINT}?${query}`;
}

/** Browser only: re-encodes as a smaller JPEG, honoring the phone's rotation. Resolves to the original if it cannot. */
export async function compressImage(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return blob;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const out: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    return out && out.size > 0 && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

export type UploadResult =
  | { ok: true; id: string }
  | { ok: false; retryable: boolean; message: string; code?: string };

/**
 * One upload. Network, sign-in and server problems are "retryable" (try again later, stop now);
 * a photo the server will never accept (wrong type, too large, job gone) is not.
 */
export async function uploadPhoto(
  photo: LocalPhoto,
  fetchImpl: typeof fetch = fetch,
  compress: (blob: Blob) => Promise<Blob> = compressImage,
): Promise<UploadResult> {
  let body: Blob = await compress(photo.blob);
  if (!SENDABLE.includes(body.type)) {
    return { ok: false, retryable: false, message: 'This photo type cannot be backed up. Use a JPEG, PNG or WebP photo.' };
  }
  if (body.size > MAX_UPLOAD_BYTES) return { ok: false, retryable: false, message: 'This photo is too large to back up.' };
  try {
    const response = await fetchImpl(uploadUrl(photo), { method: 'POST', headers: { 'content-type': body.type }, body, credentials: 'same-origin' });
    // A signed-out session is answered with the login page, not JSON.
    if (response.redirected || !(response.headers.get('content-type') || '').includes('json')) {
      return { ok: false, retryable: true, message: 'Your session expired. Sign in again to back up photos.' };
    }
    const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string; code?: string };
    if (response.ok && typeof data.id === 'string') return { ok: true, id: data.id };
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    return { ok: false, retryable, code: data.code, message: data.error || 'Could not back up this photo.' };
  } catch {
    return { ok: false, retryable: true, message: 'No connection. Photos will back up when you are online.' };
  }
}

export type SyncSummary = {
  uploaded: number;
  /** Photos the server will never accept; each keeps its reason in uploadError. */
  failed: number;
  /** Photos still to go: storage not connected, offline, or signed out. */
  waiting: number;
  notConfigured: boolean;
  /** The last reason uploading stopped early, for the screen. */
  message: string;
};

export type SyncDeps = {
  upload: (photo: LocalPhoto) => Promise<UploadResult>;
  mark: (photoId: string, patch: Partial<LocalPhoto>) => Promise<void>;
  now?: () => string;
};

let running = false;

/** Uploads every photo that has no cloud copy yet, one at a time, oldest first. Never throws. */
export async function syncPending(photos: LocalPhoto[], deps: SyncDeps): Promise<SyncSummary> {
  const summary: SyncSummary = { uploaded: 0, failed: 0, waiting: 0, notConfigured: false, message: '' };
  const pending = photos.filter((photo) => !photo.remoteId && photo.jobId && !photo.uploadError).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (running) return { ...summary, waiting: pending.length };
  running = true;
  try {
    for (let index = 0; index < pending.length; index++) {
      const photo = pending[index];
      let result: UploadResult;
      try {
        result = await deps.upload(photo);
      } catch {
        result = { ok: false, retryable: true, message: 'Could not back up photos right now.' };
      }
      if (result.ok) {
        await deps.mark(photo.id, { remoteId: result.id, uploadedAt: (deps.now ?? (() => new Date().toISOString()))(), uploadError: undefined });
        summary.uploaded++;
        continue;
      }
      if (result.code === 'PHOTO_STORAGE_NOT_CONFIGURED') summary.notConfigured = true;
      if (result.retryable || result.code === 'PHOTO_STORAGE_NOT_CONFIGURED') {
        // Offline, signed out or not connected: the rest would fail the same way. Stop and try later.
        summary.waiting = pending.length - index;
        summary.message = result.message;
        return summary;
      }
      await deps.mark(photo.id, { uploadError: result.message });
      summary.failed++;
    }
    return summary;
  } finally {
    running = false;
  }
}

/** One line for the screen, from what is on the phone. */
export function describeBackup(photos: Pick<LocalPhoto, 'remoteId' | 'uploadError'>[], summary?: Pick<SyncSummary, 'notConfigured' | 'message'>): string {
  const total = photos.length;
  if (!total) return summary?.notConfigured ? 'Not connected yet' : 'Nothing to back up yet';
  const saved = photos.filter((photo) => photo.remoteId).length;
  const rejected = photos.filter((photo) => photo.uploadError && !photo.remoteId).length;
  const waiting = total - saved - rejected;
  if (summary?.notConfigured && waiting > 0) return 'Not connected yet. Photos stay on this phone.';
  if (waiting > 0) return `${saved} of ${total} backed up. ${waiting} waiting for a connection.`;
  if (rejected > 0) return `${saved} of ${total} backed up. ${rejected} could not be.`;
  return `All ${total} backed up to the cloud.`;
}
