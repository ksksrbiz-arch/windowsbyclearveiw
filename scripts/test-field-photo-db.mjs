// Field photos live in one IndexedDB shared by the Photos tool and Field mode. A page that opens
// it without creating the `photos` store leaves an empty database behind at the current version;
// the browser never upgrades it again and every later photo read/write throws. Both pages must open
// it through src/lib/field-photo-db.ts, which creates the store and repairs a database already left
// without it. (The behaviour itself needs a browser; it was verified in Chromium for a fresh profile,
// a database already broken in this way, and a healthy one holding existing photos.)
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const src = fileURLToPath(new URL('../src', import.meta.url));
const read = (path) => readFileSync(join(src, path), 'utf8');
const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});

const helper = read('lib/field-photo-db.ts');
assert.ok(/createObjectStore\(PHOTO_STORE/.test(helper), 'the helper creates the photos store on upgrade');
assert.ok(/objectStoreNames\.contains\(PHOTO_STORE\)/.test(helper) && /db\.version \+ 1/.test(helper), 'the helper repairs a database that has no photos store');

for (const file of files(src)) {
  if (relative(src, file).split(sep).join('/') === 'lib/field-photo-db.ts') continue;
  const text = readFileSync(file, 'utf8');
  assert.ok(!/clearview-field-tools/.test(text), `${file.slice(src.length + 1)} names the photo database directly; use openPhotoDb()`);
  assert.ok(!/indexedDB\.open\(/.test(text), `${file.slice(src.length + 1)} opens IndexedDB directly; use openPhotoDb()`);
}
for (const page of ['pages/internal/tools/photos.astro', 'pages/internal/jobs/field.astro']) {
  assert.ok(/openPhotoDb/.test(read(page)) && /field-photo-db/.test(read(page)), `${page} opens photos through the shared helper`);
}
console.log('field photo db: ok');
