import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const pagesRoot = path.join(root, 'src', 'pages');
const publicRoot = path.join(root, 'public');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const pageFiles = walk(pagesRoot).filter((file) => /\.(astro|md|mdx)$/.test(file));
const publicFiles = walk(publicRoot);
const routeFiles = new Set(['/']);

for (const file of pageFiles) {
  const rel = path.relative(pagesRoot, file).replaceAll(path.sep, '/');
  if (rel === '404.astro') continue;
  if (/^\[.+\]\.(astro|md|mdx)$/.test(rel) || rel.includes('/[')) continue;
  const noExt = rel.replace(/\.(astro|md|mdx)$/, '');
  if (noExt === 'index') routeFiles.add('/');
  else if (noExt.endsWith('/index')) routeFiles.add(`/${noExt.slice(0, -'/index'.length)}`);
  else routeFiles.add(`/${noExt}`);
}

function normalizeRoute(href) {
  const raw = href.split('#')[0].split('?')[0];
  if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:')) return null;
  if (!raw.startsWith('/')) return null;
  return raw === '/' ? '/' : raw.replace(/\/$/, '');
}

const failures = [];
const warnings = [];
const externalLinks = [];
const literalHrefs = new Map();

for (const file of pageFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replaceAll(path.sep, '/');

  // Catch the class of malformed TypeScript generic-arrow expressions that
  // previously caused Astro parser failures in the internal app.
  if (/\b(?:const|let)\s+\w+\s*=\s*<T\s+extends\s+Element>/.test(source)) {
    failures.push(`${rel}: generic arrow helper can be parsed as Astro markup; use a named function instead.`);
  }

  // Every public page should have a BaseLayout unless it is an intentionally
  // special Astro endpoint/page such as 404. The marketing pages all rely on
  // BaseLayout for canonical/OG/meta/accessibility infrastructure.
  if (file.startsWith(pagesRoot) && !rel.startsWith('src/pages/internal/') && !rel.startsWith('src/pages/api/') && !rel.endsWith('/404.astro')) {
    if (!source.includes('BaseLayout')) warnings.push(`${rel}: no BaseLayout reference found; verify SEO/social metadata manually.`);
  }

  for (const match of source.matchAll(/(?:href|action)\s*=\s*["']([^"']+)["']/g)) {
    const href = match[1];
    const route = normalizeRoute(href);
    if (route) {
      if (!literalHrefs.has(route)) literalHrefs.set(route, []);
      literalHrefs.get(route).push(rel);
    }
    if (/^https?:\/\//.test(href)) externalLinks.push({ rel, href });
  }
}

for (const [route, sources] of literalHrefs) {
  // Query/hash variants are normalized above. Dynamic Astro expressions are
  // intentionally excluded because they cannot be resolved statically here.
  if (route.startsWith('/internal')) continue;
  if (routeFiles.has(route)) continue;
  // Public assets are valid destinations too.
  const asset = path.join(publicRoot, route.replace(/^\//, ''));
  if (fs.existsSync(asset)) continue;
  failures.push(`Broken internal route ${route} referenced by ${sources.slice(0, 3).join(', ')}`);
}

// Marketing forms should have an explicit action and method so they work even
// if client-side JavaScript is unavailable.
for (const file of pageFiles) {
  if (file.startsWith(pagesRoot) && !file.includes(`${path.sep}internal${path.sep}`)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const form of source.matchAll(/<form\b[^>]*>/g)) {
      if (!/\baction\s*=/.test(form[0])) warnings.push(`${path.relative(root, file)}: form has no explicit action.`);
      if (!/\bmethod\s*=/.test(form[0])) warnings.push(`${path.relative(root, file)}: form has no explicit method.`);
    }
  }
}

// External links opened in a new tab must carry noopener/noreferrer.
for (const file of pageFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/g)) {
    if (!/\brel=["'][^"']*(?:noopener|noreferrer)/.test(match[0])) {
      failures.push(`${path.relative(root, file)}: target="_blank" link missing noopener/noreferrer.`);
    }
  }
}

// The public marketing platform must not accidentally expose internal app
// navigation through the sitemap or robots metadata.
const astroConfig = fs.readFileSync(path.join(root, 'astro.config.mjs'), 'utf8');
assert.match(astroConfig, /path\.startsWith\('\/internal\/'\)/);
assert.match(astroConfig, /path !== '\/internal'/);

if (failures.length) {
  console.error('Marketing platform audit: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Marketing platform audit: PASS (${pageFiles.length} content pages scanned, ${literalHrefs.size} internal destinations checked).`);
if (warnings.length) {
  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 25)) console.log(`- ${warning}`);
  if (warnings.length > 25) console.log(`- …and ${warnings.length - 25} more.`);
}
