// Measures how sharp every photo on the built site really is, in a real browser.
//
//   npm run build && npx astro preview --port 4330 &
//   node scripts/audit-image-delivery.mjs [baseUrl] [--all] [--json out.json]
//
// For each page it loads three screens (1440 px at 1x, 1440 px at 2x, a 390 px phone at 3x), scrolls the
// whole page so lazy images load, then for every photo compares the file the browser chose with the pixels
// the tile needs. A tile that shows its photo with `object-fit: cover` needs the WIDER of its own width and
// (its height x the photo's ratio), times the screen's pixel ratio. Sharpness 1.0 is exactly enough; under
// 0.9 is soft; over 1.8 is bytes wasted.
//
// Not part of `npm run test:all`: it needs Playwright and a Chromium, which this repo does not install.
// `npm run test:image-delivery` is the CI guard; this is the tool that found the problems it guards.
// Set CHROMIUM_PATH to use a browser Playwright did not download itself.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const base = args.find((arg) => /^https?:/.test(arg)) ?? 'http://127.0.0.1:4330';
const all = args.includes('--all');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const root = fileURLToPath(new URL('..', import.meta.url));

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run `npm i --no-save playwright` (and use CHROMIUM_PATH if you have a browser already).');
  process.exit(2);
}

const profiles = [
  { name: 'desktop 1x', viewport: { width: 1440, height: 900 }, dpr: 1 },
  { name: 'laptop 2x', viewport: { width: 1440, height: 900 }, dpr: 2 },
  { name: 'phone 3x', viewport: { width: 390, height: 844 }, dpr: 3 },
];
const key = ['/', '/gallery', '/process', '/window-features', '/replacement', '/siding', '/new-construction', '/sliding-glass-doors', '/about', '/reviews', '/areas/camas', '/guides/window-replacement-cost-washington'];

function builtPages() {
  const dist = join(root, 'dist');
  const pages = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (dir !== dist || !/^(internal|_astro)$/.test(name)) walk(path);
      } else if (name.endsWith('.html') && /<img/.test(readFileSync(path, 'utf8'))) {
        pages.push(path.slice(dist.length).replace(/\\/g, '/').replace(/\.html$/, '').replace(/\/index$/, '') || '/');
      }
    }
  })(dist);
  return pages.filter((page) => page !== '/404');
}
const pages = all ? builtPages() : key;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const rows = [];
for (const profile of profiles) {
  for (const path of pages) {
    const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.dpr });
    const page = await context.newPage();
    const response = await page.goto(base + path, { waitUntil: 'load' }).catch(() => null);
    if (!response || response.status() >= 400) {
      rows.push({ profile: profile.name, path, error: response ? response.status() : 'no response' });
      await context.close();
      continue;
    }
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < height; y += profile.viewport.height * 0.6) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(800);
    const photos = await page.evaluate(async (dpr) => {
      // naturalWidth is density-scaled for srcset w-descriptors; decode the chosen file alone for real pixels.
      // An <img> with no source yet (or a data: URI) has nothing to measure.
      const urlOf = (img) => img.currentSrc || img.src;
      const measurable = [...document.images].filter((img) => /^https?:/.test(urlOf(img)));
      const real = {};
      await Promise.all(
        [...new Set(measurable.map(urlOf))].map(async (url) => {
          try {
            const probe = new Image();
            probe.src = url;
            await probe.decode();
            real[url] = { w: probe.naturalWidth, h: probe.naturalHeight };
          } catch {
            real[url] = { w: 0, h: 0 };
          }
        }),
      );
      const bytes = Object.fromEntries(performance.getEntriesByType('resource').map((entry) => [entry.name, entry.encodedBodySize]));
      return measurable
        .filter((img) => !/^\/(logo|models)\//.test(new URL(urlOf(img)).pathname) && !/\.svg/.test(urlOf(img)))
        .map((img) => {
          const box = img.getBoundingClientRect();
          const url = urlOf(img);
          const file = real[url] ?? { w: 0, h: 0 };
          const ratio = file.w && file.h ? file.w / file.h : 1;
          const needed = Math.max(box.width, box.height * ratio) * dpr;
          return { file: new URL(url).pathname.split('/').pop(), fileWidth: file.w, box: `${Math.round(box.width)}x${Math.round(box.height)}`, sharpness: needed ? +(file.w / needed).toFixed(2) : null, kb: Math.round((bytes[url] ?? 0) / 1024), visible: box.width > 0 && box.height > 0 };
        });
    }, profile.dpr);
    rows.push({ profile: profile.name, path, photos });
    await context.close();
  }
}
await browser.close();

if (jsonOut) writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
for (const profile of profiles) {
  const mine = rows.filter((row) => row.profile === profile.name && row.photos);
  const photos = mine.flatMap((row) => row.photos.map((photo) => ({ ...photo, path: row.path }))).filter((photo) => photo.visible);
  const soft = photos.filter((photo) => photo.sharpness !== null && photo.sharpness < 0.9);
  const wasted = photos.filter((photo) => photo.sharpness > 1.8);
  const kb = photos.reduce((sum, photo) => sum + photo.kb, 0);
  console.log(`${profile.name.padEnd(11)} photos ${photos.length}  soft (<0.9x) ${soft.length}  very soft (<0.6x) ${soft.filter((p) => p.sharpness < 0.6).length}  over-sized (>1.8x) ${wasted.length}  transferred ${kb} KB`);
  for (const photo of soft.sort((a, b) => a.sharpness - b.sharpness).slice(0, 10)) console.log(`   ${String(photo.sharpness).padEnd(5)} ${photo.path}  ${photo.file.slice(0, 40)}  file ${photo.fileWidth}px  tile ${photo.box}`);
}
for (const row of rows.filter((entry) => entry.error)) console.log(`ERROR ${row.profile} ${row.path}: ${row.error}`);
