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
const routeFiles = new Set(['/']);
const dynamicRoutes = [];

for (const file of pageFiles) {
  const rel = path.relative(pagesRoot, file).replaceAll(path.sep, '/');
  if (rel === '404.astro') continue;
  const ext = /\.(astro|md|mdx)$/.exec(rel)?.[0] || '';
  const noExt = rel.slice(0, -ext.length);
  const parts = noExt.split('/');
  const dynamic = parts.some((part) => /^\[.+\]$/.test(part));
  const routeParts = parts.map((part) => {
    if (part === 'index') return '';
    if (/^\[.+\]$/.test(part)) return ':dynamic';
    return part;
  }).filter(Boolean);
  const route = `/${routeParts.join('/')}` || '/';
  if (dynamic) dynamicRoutes.push(route);
  else routeFiles.add(route);
}

function normalizeRoute(href) {
  const raw = href.split('#')[0].split('?')[0];
  if (!raw || raw.startsWith('mailto:') || raw.startsWith('tel:')) return null;
  if (!raw.startsWith('/')) return null;
  return raw === '/' ? '/' : raw.replace(/\/$/, '');
}

function matchesDynamic(route) {
  return dynamicRoutes.some((pattern) => {
    const regex = new RegExp(`^${pattern.split('/').map((part) => part === ':dynamic' ? '[^/]+' : part.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')).join('/')}\/?$`);
    return regex.test(route);
  });
}

const failures = [];
const warnings = [];
const literalHrefs = new Map();

for (const file of pageFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replaceAll(path.sep, '/');

  if (/\b(?:const|let)\s+\w+\s*=\s*<T\s+extends\s+Element>/.test(source)) {
    failures.push(`${rel}: generic arrow helper can be parsed as Astro markup; use a named function instead.`);
  }

  if (!rel.startsWith('src/pages/internal/') && !rel.startsWith('src/pages/api/') && !rel.endsWith('/404.astro')) {
    if (!source.includes('BaseLayout')) warnings.push(`${rel}: no BaseLayout reference found; verify metadata manually.`);
  }

  for (const match of source.matchAll(/(?:href|action)\s*=\s*["']([^"']+)["']/g)) {
    const href = match[1];
    const route = normalizeRoute(href);
    if (route) {
      if (!literalHrefs.has(route)) literalHrefs.set(route, []);
      literalHrefs.get(route).push(rel);
    }
  }
}

for (const [route, sources] of literalHrefs) {
  if (route.startsWith('/internal')) continue;
  if (routeFiles.has(route) || matchesDynamic(route)) continue;
  const asset = path.join(publicRoot, route.replace(/^\//, ''));
  if (fs.existsSync(asset)) continue;
  failures.push(`Broken internal route ${route} referenced by ${sources.slice(0, 3).join(', ')}`);
}

for (const file of pageFiles) {
  const rel = path.relative(root, file).replaceAll(path.sep, '/');
  if (rel.startsWith('src/pages/internal/') || rel.startsWith('src/pages/api/')) continue;
  const source = fs.readFileSync(file, 'utf8');
  for (const form of source.matchAll(/<form\b[^>]*>/g)) {
    if (!/\baction\s*=/.test(form[0])) warnings.push(`${rel}: form has no explicit action.`);
    if (!/\bmethod\s*=/.test(form[0])) warnings.push(`${rel}: form has no explicit method.`);
  }
}

for (const file of pageFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/g)) {
    if (!/\brel=["'][^"']*(?:noopener|noreferrer)/.test(match[0])) {
      failures.push(`${path.relative(root, file)}: target="_blank" link missing noopener/noreferrer.`);
    }
  }
}

// Public lead endpoint hardening: the browser submits multipart form data,
// cross-origin browser POSTs are rejected, bodies are capped, and GET must
// not disclose provider/template implementation details.
const estimate = fs.readFileSync(path.join(root, 'functions', 'api', 'estimate.js'), 'utf8');
assert.match(estimate, /MAX_BODY_BYTES\s*=\s*64\s*\*\s*1024/);
assert.match(estimate, /request\.headers\.get\('origin'\)/);
assert.match(estimate, /contentType\.toLowerCase\(\)\.startsWith\('multipart\/form-data'\)/);
assert.match(estimate, /const emailLooksReal\s*=\s*\//);
assert.match(estimate, /function escapeHtmlAttr\(/);
assert.match(estimate, /onRequestGet\(\)\s*\{\s*return json\(\{ error: 'POST a request from the estimate form\.' \}, 405\);/s);

const headers = fs.readFileSync(path.join(publicRoot, '_headers'), 'utf8');
assert.match(headers, /Strict-Transport-Security:\s*max-age=31536000;\s*includeSubDomains/);
assert.match(headers, /X-Frame-Options:\s*DENY/);
assert.match(headers, /X-Content-Type-Options:\s*nosniff/);
assert.match(headers, /Referrer-Policy:\s*strict-origin-when-cross-origin/);

const estimateForm = fs.readFileSync(path.join(root, 'src', 'components', 'EstimateForm.astro'), 'utf8');
assert.match(estimateForm, /<form[^>]+enctype=["']multipart\/form-data["']/);

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
