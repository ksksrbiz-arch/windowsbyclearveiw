// Guards the ICM structure itself (see .ai/references/icm-rules.md):
// - root CLAUDE.md is a router, <= 80 lines, with load/exclusion tables
// - reference files are <= 200 lines
// - every workflow/stage contract declares Input / Process / Output / Stop conditions / Completion
// - every specialist declares Completion
// - every repo path and `npm run` script named in the router/contracts really exists
// - every workflow and specialist directory is reachable from the router
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const lines = (p) => read(p).replace(/\n$/, '').split('\n').length;
const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}
const rel = (p) => relative(root, p).split('\\').join('/');
const aiFiles = [...walk(join(root, '.ai'))].map(rel).filter((p) => p.endsWith('.md'));

// 1. Root router.
const ROOT_MAX = 80;
const REF_MAX = 200;
check(lines('CLAUDE.md') <= ROOT_MAX, `CLAUDE.md is ${lines('CLAUDE.md')} lines; router cap is ${ROOT_MAX}`);
check(/\| Task \| Load \| Do not load \|/.test(read('CLAUDE.md')), 'CLAUDE.md needs a "Task | Load | Do not load" table');
check(/Exclusion rule/.test(read('CLAUDE.md')), 'CLAUDE.md needs an exclusion rule');
check(/\| Route \| Load \| Do not load \|/.test(read('.ai/CONTEXT.md')), '.ai/CONTEXT.md needs a "Route | Load | Do not load" table');

// 2. References stay small.
for (const f of aiFiles.filter((p) => p.startsWith('.ai/references/'))) {
  check(lines(f) <= REF_MAX, `${f} is ${lines(f)} lines; reference cap is ${REF_MAX}`);
}

// 3. Workflow and stage contracts.
const workflowContracts = aiFiles.filter((p) => /^\.ai\/workflows\/.+\/CONTEXT\.md$/.test(p));
const required = [
  [/^## Inputs?\b/m, 'Input'],
  [/^## Process\b/m, 'Process'],
  [/^## Outputs?\b/m, 'Output'],
  [/^## Stop conditions\b/m, 'Stop conditions'],
  [/^## Completion\b/m, 'Completion'],
];
for (const f of workflowContracts) {
  const text = read(f);
  for (const [re, name] of required) check(re.test(text), `${f} is missing "## ${name}"`);
}
// Top-level workflows (not stages) also carry a load/exclusion table.
for (const f of workflowContracts.filter((p) => p.split('/').length === 4 && !/\/build-plan\//.test(p))) {
  check(/\| Load \| Do not load \|/.test(read(f)), `${f} needs a "Load | Do not load" table`);
}

// 4. Specialists.
const specialistContracts = aiFiles.filter((p) => /^\.ai\/specialists\/.+\/CONTEXT\.md$/.test(p));
for (const f of specialistContracts) check(/^## Completion\b/m.test(read(f)), `${f} is missing "## Completion"`);

// 5. Reachability from the routers.
const claude = read('CLAUDE.md');
const ctx = read('.ai/CONTEXT.md');
const workflowDirs = readdirSync(join(root, '.ai/workflows')).filter((n) => statSync(join(root, '.ai/workflows', n)).isDirectory());
for (const w of workflowDirs) {
  check(ctx.includes(`workflows/${w}/`), `.ai/CONTEXT.md does not route to workflows/${w}/`);
  check(claude.includes(`.ai/workflows/${w}/`), `CLAUDE.md does not route to .ai/workflows/${w}/`);
}
const specialistDirs = readdirSync(join(root, '.ai/specialists')).filter((n) => statSync(join(root, '.ai/specialists', n)).isDirectory());
for (const s of specialistDirs) check(ctx.includes(`specialists/${s}/`), `.ai/CONTEXT.md does not route to specialists/${s}/`);

// 6. Paths and npm scripts named in routers/contracts exist.
const pkg = JSON.parse(read('package.json'));
const docs = ['CLAUDE.md', ...aiFiles];
for (const f of docs) {
  const text = read(f);
  for (const m of text.matchAll(/`((?:\.ai|functions|scripts|src|internal|docs|workers|public)\/[^`\s*<>{}]+)`/g)) {
    const p = m[1].replace(/[.,;:]+$/, '');
    if (/[…]|\.\.\./.test(p)) continue;
    check(existsSync(join(root, p)), `${f} names a path that does not exist: ${p}`);
  }
  for (const m of text.matchAll(/`((?:workflows|specialists|references)\/[^`\s*<>{}]+)`/g)) {
    const p = m[1].replace(/[.,;:]+$/, '');
    check(existsSync(join(root, '.ai', p)), `${f} names a context path that does not exist: .ai/${p}`);
  }
  for (const m of text.matchAll(/npm run ([a-z0-9:_-]+)/gi)) {
    check(pkg.scripts?.[m[1]], `${f} names an npm script that does not exist: ${m[1]}`);
  }
}

// 7. The business-critical rules survive in the root router, verbatim in substance.
for (const [re, label] of [
  [/Never invent business facts/, 'no invented business facts'],
  [/windowsbyclearview\.com/, 'canonical public domain'],
  [/windowsbyclearveiw\.com/, 'legacy production mail domain'],
  [/Human approval is a state boundary/, 'human approval boundary'],
  [/D1 is transactional truth/, 'D1 is truth'],
  [/Stop on ambiguity/, 'stop on ambiguity'],
]) check(re.test(claude), `CLAUDE.md lost a non-negotiable: ${label}`);

assert.equal(problems.length, 0, `ICM structure problems:\n - ${problems.join('\n - ')}`);
console.log(`ICM structure OK: router ${lines('CLAUDE.md')}/${ROOT_MAX} lines, ${workflowContracts.length} workflow contracts, ${specialistContracts.length} specialists, ${aiFiles.filter((p) => p.startsWith('.ai/references/')).length} references.`);
