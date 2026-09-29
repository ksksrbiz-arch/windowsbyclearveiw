// Guards the customer-facing terminology rule: public pages, guides, city pages,
// and the Ask knowledge index must not name install methods (insert / full-frame /
// pocket). We measure every opening and put the approach in the written estimate;
// we do not explain methods to customers. Internal Command Center code is exempt.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const scanRoots = ['src/pages', 'src/components', 'src/content', 'src/data', 'functions/ask/_data', 'functions/ask/api'];
const skip = (path) => path.includes('/pages/internal/');
const banned = [
  [/full[- ]frame/i, 'full-frame'],
  [/\binserts?\b(?!\s*(?:into|adjacent))/i, 'insert'],
  [/\bpocket (?:window|replacement|install)/i, 'pocket'],
  [/\b(?:the|your|chosen|each|per) methods?\b|\bmethod per opening/i, 'install method'],
  [/block[- ]frame|block and fin|nail(?:ing)?[- ]fin(?! window| unit| set)/i, 'method jargon'],
];
// Nailing-fin is fine on new-construction copy; this list keeps the rule narrow.
const allowFiles = new Set(['functions/ask/api/chat.js']); // system prompt states the rule itself

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const hits = [];
for (const scanRoot of scanRoots) {
  for (const path of walk(join(root, scanRoot))) {
    const rel = relative(root, path);
    if (skip(path) || allowFiles.has(rel) || !/\.(astro|md|json|ts|mjs)$/.test(path)) continue;
    readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // code comments are not customer copy
      for (const [re, label] of banned) {
        if (re.test(line)) hits.push(`${rel}:${i + 1} [${label}] ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

assert.equal(hits.length, 0, `install-method terms in customer-facing files:\n${hits.join('\n')}`);

// The Ask assistant must be told not to use the terms either.
const chat = readFileSync(join(root, 'functions/ask/api/chat.js'), 'utf8');
assert.ok(/TERMINOLOGY: do not describe or compare install methods/.test(chat), 'Ask system prompt carries the terminology rule');

// The old guide URL must redirect, not 404.
const redirects = readFileSync(join(root, 'public/_redirects'), 'utf8');
assert.ok(/^\/guides\/full-frame-vs-insert \/guides\/what-your-openings-need 301$/m.test(redirects), 'old guide URL redirects');

// The calculator no longer asks for a method.
const estimator = readFileSync(join(root, 'src/components/CostEstimator.astro'), 'utf8');
assert.ok(!/est-method/.test(estimator), 'calculator has no method picker');

console.log('public terminology: ok');
