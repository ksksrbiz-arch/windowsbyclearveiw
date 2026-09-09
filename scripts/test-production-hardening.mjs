import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const field = read('src/pages/internal/jobs/field.astro');
const photos = read('src/pages/internal/tools/photos.astro');
const checklist = read('functions/internal/api/job-checklist.js');
const closeout = read('functions/internal/api/job-closeout.js');
const jobs = read('functions/internal/api/jobs.js');
const middleware = read('functions/internal/_middleware.js');
const session = read('functions/internal/_lib/session.mjs');
const layout = read('src/layouts/InternalLayout.astro');

// Field execution must expose the safety-critical workflow and evidence model.
// Only UI affordances belong here. The PHOTO_EVIDENCE_REQUIRED / OPEN_EXCEPTION
// gate codes are a server contract, asserted against job-checklist.js below —
// the field screen deliberately renders the server's own human-readable message
// (`d.error`) rather than re-implementing the code list, so the gate text has
// exactly one source of truth.
for (const token of [
  'One opening at a time', 'data-measure="width"', 'data-exception',
  'data-add-material', 'data-save-evidence', 'Photograph', 'Complete',
  'indexedDB.open',
]) assert.match(field, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

// Gate failures must surface the server-provided human-readable message.
// Do not add client-side branches for PHOTO_EVIDENCE_REQUIRED / OPEN_EXCEPTION:
// those codes remain machine-readable server contracts, while the server owns
// the wording and can evolve it without creating a second source of truth.
assert.match(field, /d\.error/);
assert.doesNotMatch(field, /PHOTO_EVIDENCE_REQUIRED|OPEN_EXCEPTION/);

// Photo capture must be tied to job/opening/stage and survive normal reloads on-device.
for (const token of ['jobId', 'openingIndex', 'stage', 'before', 'during', 'after', 'issue', 'indexedDB']) {
  assert.match(photos, new RegExp(token));
}

// Server gates remain authoritative; browser state cannot bypass them.
for (const token of ['FIELD_GATE_SEQUENCE', 'FIELD_MEASUREMENTS_REQUIRED', 'PHOTO_EVIDENCE_REQUIRED', 'OPENING_INCOMPLETE', 'OPEN_EXCEPTION', 'job_opening_evidence']) {
  assert.match(checklist, new RegExp(token));
}

// Finalized closeout must be immutable and required before the job becomes completed.
assert.match(closeout, /finalized_at/);
assert.match(closeout, /already finalized|finalized closeout|read-only/i);
assert.match(jobs, /CLOSEOUT_FINALIZATION_REQUIRED/);
// c4e987d also reads signoff_notes here, to fall back to the finalized
// closeout's sign-off text when closeout notes are otherwise empty.
assert.match(jobs, /SELECT finalized_at(?:, signoff_notes)? FROM job_closeouts/);

// Internal routes must remain private and session cookies must be hardened.
assert.match(middleware, /X-Robots-Tag/);
assert.match(middleware, /Cache-Control/);
assert.match(middleware, /verifySessionToken/);
assert.match(session, /HttpOnly/);
assert.match(session, /Secure/);
assert.match(session, /SameSite=Lax/);
assert.match(layout, /viewport-fit=cover/);
assert.match(layout, /internal-mobile-nav/);

console.log('Production hardening contract checks: PASS');
