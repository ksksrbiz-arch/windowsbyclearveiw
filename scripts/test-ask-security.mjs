import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const middleware = fs.readFileSync(path.join(root, 'functions', 'ask', 'api', '_middleware.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'functions', 'ask', 'api', 'chat.js'), 'utf8');

assert.match(middleware, /MAX_BODY_BYTES\s*=\s*96\s*\*\s*1024/);
assert.match(middleware, /new URL\(origin\)\.origin === new URL\(request\.url\)\.origin/);
assert.match(middleware, /contentLength > MAX_BODY_BYTES/);
assert.match(middleware, /application\/json/);
assert.match(middleware, /allow: 'POST, OPTIONS'/);

// Chat itself must continue to cap the user-controlled prompt/history before
// anything reaches an external model provider.
assert.match(chat, /MAX_MESSAGE_LENGTH=500/);
assert.match(chat, /MAX_HISTORY_MESSAGES=10/);
assert.match(chat, /slice\(0,MAX_MESSAGE_LENGTH\)/);
assert.match(chat, /cleanHistory\(body\.history\)/);

// Trailing slash must not dodge the per-route rate limit; null/array bodies and
// null tool arguments must be rejected cleanly instead of throwing.
assert.match(middleware, /pathname\.split\('\/'\)\.filter\(Boolean\)\.pop\(\)/);
assert.match(chat, /Body must be a JSON object/);
assert.match(chat, /args must be an object/);

console.log('Ask API security audit: PASS');
