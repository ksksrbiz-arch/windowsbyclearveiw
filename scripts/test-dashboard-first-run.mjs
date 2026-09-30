// The dashboard shows a "first customer" panel when the business has no records yet (the state
// Mark starts from). It must start hidden, only appear when every list is empty, and link to pages
// that exist. Static contract check: the behaviour itself was verified in a browser.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const page = readFileSync(`${root}src/pages/internal/index.astro`, 'utf8');
const panel = /<section class="cc-first-run"[\s\S]*?<\/section>/.exec(page)?.[0] ?? '';

assert.ok(/data-first-run\s+hidden/.test(panel), 'the panel starts hidden so it never flashes for a busy account');
for (const href of [...panel.matchAll(/href="([^"]+)"/g)].map((m) => m[1])) {
  const file = `${root}src/pages${href}.astro`;
  assert.ok(existsSync(file), `the panel links to ${href}, which has no page`);
}
assert.ok(panel.includes('/internal/jobs/new') && panel.includes('/internal/quotes/new'), 'offers both a general job and a window quote');
const toggle = /firstRun\.hidden=([^;]*);/.exec(page)?.[1] ?? '';
assert.ok(toggle, 'the script decides whether to show the panel');
for (const list of ['recentLeads', 'recentQuotes', 'recentJobs', 'tasks']) assert.ok(toggle.includes(list), `the panel stays hidden when ${list} has rows`);
console.log('dashboard first run: ok');
