// Runs the full regression suite locally, in the order .github/workflows/build.yml defines it.
// GitHub Actions cannot run right now (billing), so this is the verification gate.
// Usage: npm run test:all            (everything, including the Astro build)
//        npm run test:all -- --fast  (skip the Astro build and everything after it)
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fast = process.argv.includes('--fast');
const steps = [...readFileSync(`${root}.github/workflows/build.yml`, 'utf8').matchAll(/^\s*- run: npm run ([\w:-]+)\s*$/gm)].map((m) => m[1]);
const list = fast ? steps.slice(0, steps.indexOf('build')) : steps;
if (list.length === 0) { console.error('No `npm run` steps found in build.yml'); process.exit(2); }

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const results = [];
for (const name of list) {
  const started = Date.now();
  process.stdout.write(`\n=== npm run ${name}\n`);
  const r = spawnSync(npm, ['run', name], { cwd: root, stdio: 'inherit' });
  results.push({ name, ok: r.status === 0, secs: ((Date.now() - started) / 1000).toFixed(1) });
}

console.log('\n==== summary ====');
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.secs}s)`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} failed: ${failed.map((r) => r.name).join(', ')}` : `\nAll ${results.length} steps passed.`);
process.exit(failed.length ? 1 : 0);
