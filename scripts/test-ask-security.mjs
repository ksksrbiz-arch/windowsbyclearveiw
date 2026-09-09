import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
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

console.log('Ask API security audit: PASS');
