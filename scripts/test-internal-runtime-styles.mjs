// Astro scopes a page's <style> rules to elements in its own markup by adding a
// data-astro-cid attribute. Elements created at runtime (innerHTML, createElement)
// never get that attribute, so a scoped rule for their class silently does nothing
// and the list renders unstyled. Rules for runtime-created classes must be wrapped
// in :global(...). This checks every internal page for that mistake.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../src/pages/internal', import.meta.url));

function pages(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? pages(path) : name.endsWith('.astro') ? [path] : [];
  });
}

function runtimeClasses(source) {
  const js = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const made = new Set();
  for (const m of js.matchAll(/class(?:Name)?\s*=\s*\\?['"`]([^'"`$]*)/g)) for (const c of m[1].split(/\s+/)) if (c) made.add(c);
  for (const m of js.matchAll(/classList\.add\(([^)]*)\)/g)) for (const c of m[1].matchAll(/['"]([\w-]+)['"]/g)) made.add(c[1]);
  const markup = source.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const staticClasses = new Set();
  for (const m of markup.matchAll(/class(?::list)?=["{]([^">]*)/g)) for (const c of m[1].matchAll(/[\w-]+/g)) staticClasses.add(c[0]);
  return [...made].filter((c) => !staticClasses.has(c));
}

// Split a stylesheet into selectors, skipping @media preludes and declaration bodies.
function selectors(css) {
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const prelude = css.slice(i, open).trim();
    if (prelude.startsWith('@')) { i = open + 1; continue; }
    let depth = 1;
    let k = open + 1;
    while (k < css.length && depth) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
    let d = 0;
    let cur = '';
    for (const ch of prelude) {
      if (ch === '(' || ch === '[') d++;
      if (ch === ')' || ch === ']') d--;
      if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    i = k;
    while (i < css.length && /[\s}]/.test(css[i])) i++;
  }
  return out.filter(Boolean);
}

let checked = 0;
const problems = [];
for (const file of pages(root)) {
  const source = readFileSync(file, 'utf8');
  const style = /<style(?![^>]*global)[^>]*>([\s\S]*?)<\/style>/.exec(source)?.[1];
  const classes = runtimeClasses(source);
  checked++;
  if (!style || !classes.length) continue;
  for (const selector of selectors(style)) {
    if (selector.includes(':global(')) continue;
    for (const c of classes) {
      if (new RegExp(`\\.${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(selector)) problems.push(`${file.slice(root.length + 1)}: .${c} is created at runtime but styled with scoped CSS (${selector})`);
    }
  }
}
assert.deepEqual(problems, [], `Wrap these selectors in :global(...):\n${problems.join('\n')}`);
assert.ok(checked > 15, 'expected to scan the internal pages');
// Escape helpers built on textContent -> innerHTML leave quotes untouched, which lets customer data
// break out of value="..." / href="..." attributes. Every such helper must also escape quotes.
const unsafeEsc = [];
// TODO: ask-logs, tools/* still use the quote-unsafe helper (outside the Today..Payments unit).
for (const file of pages(root).filter((f) => !/ask-logs|[\\/]tools[\\/]/.test(f))) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/textContent\s*=\s*[^;]*;\s*return\s+\w+\.innerHTML(?!\.replace\()/g)) unsafeEsc.push(file.slice(root.length + 1));
}
assert.deepEqual(unsafeEsc, [], `escape helpers must also escape quotes:\n${unsafeEsc.join('\n')}`);
// The layout gives only the Field page the field-mode class (it hides the shared bottom nav, which
// would sit on top of the crew's own Previous/Next bar). The build reports that page as
// "/internal/jobs/field.html", and an exact-string comparison once silently never matched. This reads
// the built HTML, so it only runs when a build exists (CI runs it after `npm run build`).
import { existsSync } from 'node:fs';
const built = (path) => fileURLToPath(new URL(`../dist/internal/${path}`, import.meta.url));
if (existsSync(built('jobs/field.html'))) {
  const bodyClass = (path) => /<body class="([^"]*)"/.exec(readFileSync(built(path), 'utf8'))?.[1] ?? '';
  assert.ok(bodyClass('jobs/field.html').split(' ').includes('field-mode'), 'the Field page body has the field-mode class');
  for (const other of ['jobs/view.html', 'today.html', 'quotes/view.html']) assert.ok(!bodyClass(other).split(' ').includes('field-mode'), `${other} must not have field-mode`);
} else console.log('internal runtime styles: no build found, skipped the field-mode check');
console.log(`internal runtime styles: ok (${checked} pages)`);
