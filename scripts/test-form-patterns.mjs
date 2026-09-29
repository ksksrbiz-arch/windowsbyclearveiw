// Every HTML `pattern` attribute in the built site must compile as a RegExp with the
// `v` flag, which is what current browsers use. An unescaped "-" inside a class
// (e.g. [\s.-]) is a SyntaxError there, and the browser then silently skips the
// check: the estimate form's phone pattern did exactly that. Run after `npm run build`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist', import.meta.url).pathname;
if (!existsSync(dist)) { console.error('dist/ not found. Run `npm run build` first.'); process.exit(1); }
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith('.html')) yield path;
  }
}
const problems = [];
let checked = 0;
for (const file of walk(dist)) {
  for (const m of readFileSync(file, 'utf8').matchAll(/<input\b[^>]*?\bpattern="([^"]*)"/g)) {
    checked += 1;
    const pattern = decode(m[1]);
    try { new RegExp(`^(?:${pattern})$`, 'v'); }
    catch (error) { problems.push(`${file.replace(dist, '')}: pattern "${pattern}" is invalid with the v flag (${error.message})`); }
  }
}
assert.ok(checked > 0, 'expected at least one pattern attribute (the estimate form phone field)');
assert.equal(problems.length, 0, problems.join('\n'));
console.log(`form patterns: ok (${checked} checked)`);
