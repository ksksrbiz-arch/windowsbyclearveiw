// AI Gateway routing for Groq/Gemini and the model-aware guide embeddings. Network is faked; the
// real handlers' wiring is checked from their source because chat.js imports a JSON index.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gatewayBase, geminiGenerate, groqChat } from '../functions/_lib/ai-gateway.mjs';
import { EMBEDDING_MODELS, DEFAULT_EMBEDDING_MODEL, embedText, embeddingModelInfo, restAiBinding, vectorFromWorkersAi } from '../functions/ask/_lib/embeddings.mjs';
import { topMatches } from '../functions/ask/_lib/rag.mjs';
import { evaluateRetrieval } from './_lib/retrieval-eval.mjs';

process.removeAllListeners('warning');
const root = fileURLToPath(new URL('..', import.meta.url));
let groups = 0;
const ok = async (fn) => { await fn(); groups++; };
const quiet = async (fn) => { const e = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = e; } };

const GW = 'https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/clearview';
const recorder = (...replies) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: init.body, signal: init.signal });
    const next = replies.length > 1 ? replies.shift() : replies[0];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify({ ok: true }), { status: next });
  };
  return { calls, fetchImpl };
};

await ok(() => {
  assert.equal(gatewayBase({}), null, 'off by default');
  assert.equal(gatewayBase({ AI_GATEWAY_URL: GW }), GW);
  assert.equal(gatewayBase({ AI_GATEWAY_URL: `${GW}/` }), GW, 'trailing slash tolerated');
  for (const bad of ['http://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/x', 'https://evil.example/v1/0123456789abcdef0123456789abcdef/x', `${GW}/extra`, 'https://gateway.ai.cloudflare.com/v1/short/x', 'gibberish']) {
    assert.equal(gatewayBase({ AI_GATEWAY_URL: bad }), null, `rejects ${bad}`);
  }
});

await ok(async () => {
  const direct = recorder(200);
  await groqChat({ GROQ_API_KEY: 'gk' }, { model: 'm' }, { fetchImpl: direct.fetchImpl });
  assert.equal(direct.calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(direct.calls[0].headers.authorization, 'Bearer gk');
  assert.ok(!Object.keys(direct.calls[0].headers).some((h) => h.startsWith('cf-aig')), 'no gateway headers on a direct call');

  const env = { GROQ_API_KEY: 'gk', AI_GATEWAY_URL: GW };
  const via = recorder(200);
  const res = await groqChat(env, { model: 'm' }, { feature: 'ask', fetchImpl: via.fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(via.calls.length, 1, 'one call when the gateway answers');
  assert.equal(via.calls[0].url, `${GW}/groq/chat/completions`);
  assert.equal(via.calls[0].headers['cf-aig-collect-log-payload'], 'false', 'questions and answers are not stored by the gateway');
  assert.equal(JSON.parse(via.calls[0].headers['cf-aig-metadata']).feature, 'ask');
  assert.ok(!('cf-aig-authorization' in via.calls[0].headers), 'no gateway token unless configured');
  assert.equal(via.calls[0].headers.authorization, 'Bearer gk');

  const withToken = recorder(200);
  await groqChat({ ...env, AI_GATEWAY_TOKEN: 'tok' }, {}, { fetchImpl: withToken.fetchImpl });
  assert.equal(withToken.calls[0].headers['cf-aig-authorization'], 'Bearer tok');
});

await ok(async () => {
  const env = { GROQ_API_KEY: 'gk', AI_GATEWAY_URL: GW };
  for (const status of [401, 403, 404, 502, 503, 504]) {
    const r = recorder(status, 200);
    const res = await quiet(() => groqChat(env, {}, { fetchImpl: r.fetchImpl }));
    assert.equal(res.status, 200, `gateway ${status}: answered directly`);
    assert.equal(r.calls.length, 2);
    assert.ok(r.calls[1].url.startsWith('https://api.groq.com/'));
    assert.ok(!Object.keys(r.calls[1].headers).some((h) => h.startsWith('cf-aig')), 'the direct retry carries no gateway headers');
  }
  const down = recorder(new TypeError('network'), 200);
  assert.equal((await quiet(() => groqChat(env, {}, { fetchImpl: down.fetchImpl }))).status, 200, 'gateway unreachable: direct');
  for (const status of [400, 429, 500]) {
    const r = recorder(status, 200);
    assert.equal((await groqChat(env, {}, { fetchImpl: r.fetchImpl })).status, status, `${status} is the provider's answer; not retried`);
    assert.equal(r.calls.length, 1);
  }
  const controller = new AbortController();
  controller.abort();
  const aborted = recorder(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await assert.rejects(quiet(() => groqChat(env, {}, { signal: controller.signal, fetchImpl: aborted.fetchImpl })), /aborted/, 'a timeout is not retried against the provider');
  assert.equal(aborted.calls.length, 1);
});

await ok(async () => {
  const env = { GEMINI_API_KEY: 'sekret-key', AI_GATEWAY_URL: GW };
  const direct = recorder(200);
  await geminiGenerate({ GEMINI_API_KEY: 'sekret-key' }, 'gemini-3.6-flash', { contents: [] }, { fetchImpl: direct.fetchImpl });
  assert.equal(direct.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent');
  const via = recorder(200);
  await geminiGenerate(env, 'gemini-3.6-flash', { contents: [] }, { fetchImpl: via.fetchImpl });
  assert.equal(via.calls[0].url, `${GW}/google-ai-studio/v1beta/models/gemini-3.6-flash:generateContent`);
  for (const call of [...direct.calls, ...via.calls]) {
    assert.equal(call.headers['x-goog-api-key'], 'sekret-key');
    assert.ok(!call.url.includes('sekret-key') && !call.url.includes('key='), 'the key never appears in a URL');
  }
  assert.equal(via.calls[0].headers['cf-aig-collect-log-payload'], 'false');
  const fall = recorder(404, 200);
  assert.equal((await quiet(() => geminiGenerate(env, 'gemini-3.6-flash', {}, { fetchImpl: fall.fetchImpl }))).status, 200);
  assert.ok(fall.calls[1].url.startsWith('https://generativelanguage.googleapis.com/'));
});

await ok(() => {
  assert.deepEqual(vectorFromWorkersAi({ data: [[0.1, 0.2]] }), [0.1, 0.2]);
  assert.deepEqual(vectorFromWorkersAi({ response: [[1, 2, 3]] }), [1, 2, 3]);
  for (const bad of [null, {}, { data: [] }, { data: [['a']] }, { data: [[NaN]] }, { data: 'x' }]) assert.throws(() => vectorFromWorkersAi(bad), /no embedding/);
  assert.equal(DEFAULT_EMBEDDING_MODEL, '@cf/baai/bge-m3');
  assert.ok(embeddingModelInfo('gemini-embedding-001') && embeddingModelInfo('@cf/baai/bge-m3'));
  assert.equal(embeddingModelInfo('nope'), null);
  for (const info of Object.values(EMBEDDING_MODELS)) assert.ok(info.minScore > 0 && info.minScore < 1);
});

await ok(async () => {
  const seen = [];
  const env = { AI: { run: async (model, input) => { seen.push({ model, input }); return { data: [[0.5, 0.5]] }; } } };
  assert.deepEqual(await embedText(env, 'hello', '@cf/baai/bge-m3'), [0.5, 0.5]);
  assert.deepEqual(seen[0], { model: '@cf/baai/bge-m3', input: { text: ['hello'] } });
  await assert.rejects(embedText({}, 'x', '@cf/baai/bge-m3'), /binding/, 'no AI binding: a clear error, handled upstream as "no matches"');
  await assert.rejects(embedText(env, 'x', 'mystery'), /Unknown embedding model/);
  const g = recorder(200);
  g.fetchImpl.__ = 1;
  const geminiFetch = async (url, init) => { g.calls.push({ url: String(url), headers: init.headers }); return new Response(JSON.stringify({ embedding: { values: [1, 2] } }), { status: 200 }); };
  assert.deepEqual(await embedText({ GEMINI_API_KEY: 'k' }, 't', 'gemini-embedding-001', geminiFetch), [1, 2]);
  assert.ok(!g.calls[0].url.includes('key='), 'Gemini key is sent as a header');
  assert.equal(g.calls[0].headers['x-goog-api-key'], 'k');
  await assert.rejects(embedText({}, 't', 'gemini-embedding-001', geminiFetch), /not configured/);

  const rest = recorder(200);
  const okFetch = async (url, init) => { rest.calls.push({ url: String(url), headers: init.headers, body: init.body }); return new Response(JSON.stringify({ success: true, result: { data: [[9]] } }), { status: 200 }); };
  const binding = restAiBinding({ accountId: 'acct', apiToken: 'tok', fetchImpl: okFetch });
  assert.deepEqual(await binding.run('@cf/baai/bge-m3', { text: ['a'] }), { data: [[9]] });
  assert.equal(rest.calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/baai/bge-m3');
  assert.equal(rest.calls[0].headers.authorization, 'Bearer tok');
  const failing = restAiBinding({ accountId: 'a', apiToken: 't', fetchImpl: async () => new Response(JSON.stringify({ success: false, errors: [{ message: 'bad token' }] }), { status: 403 }) });
  await assert.rejects(failing.run('m', {}), /403.*bad token/);
});

await ok(() => {
  const chunks = [{ id: 'a', slug: 'a', embedding: [1, 0] }, { id: 'b', slug: 'b', embedding: [0.9, 0.1, 0] }, { id: 'c', slug: 'c', embedding: [0.8, 0.6] }];
  const hits = topMatches([1, 0], chunks, 6, 0);
  assert.deepEqual(hits.map((h) => h.id), ['a', 'c'], 'a chunk from another model (other length) is skipped, not scored as noise');
  assert.ok(hits.every((h) => Number.isFinite(h.score)));
});

await ok(async () => {
  // Bag-of-words fake embedder: same words, same direction.
  const vocab = ['fog', 'pane', 'cost', 'price', 'vinyl', 'glass', 'paris', 'bread'];
  const embed = async (text) => vocab.map((w) => (text.toLowerCase().includes(w) ? 1 : 0.01));
  const chunks = [
    { id: 'f#0', slug: 'fog', embedding: await embed('fog between the pane glass') },
    { id: 'c#0', slug: 'cost', embedding: await embed('cost and price of vinyl') },
  ];
  const questions = {
    onTopic: [{ q: 'why is there fog in my pane', slugs: ['fog'] }, { q: 'what is the price', slugs: ['cost'] }, { q: 'cost of vinyl', slugs: ['cost'] }],
    offTopic: ['capital of paris', 'bake bread'],
  };
  const { summary } = await evaluateRetrieval({ questions, chunks, embed, minScore: 0.5 });
  assert.equal(summary.hitAt1, 1);
  assert.equal(summary.separable, true);
  assert.ok(summary.suggestedMinScore > summary.offTopicBestScore.max && summary.suggestedMinScore < summary.onTopicBestScore.min);
  assert.equal(summary.atMinScore.onTopicCited, 1);
  assert.equal(summary.atMinScore.offTopicCited, 0);
  const wrong = await evaluateRetrieval({ questions: { onTopic: [{ q: 'cost price', slugs: ['fog'] }], offTopic: ['x'] }, chunks, embed });
  assert.equal(wrong.summary.hitAt1, 0, 'a wrong top result is counted as a miss');
  const overlap = await evaluateRetrieval({ questions: { onTopic: [{ q: 'zzz', slugs: ['fog'] }], offTopic: ['fog pane glass'] }, chunks, embed });
  assert.equal(overlap.summary.separable, false);
  assert.equal(overlap.summary.suggestedMinScore, null, 'no clean floor is reported as none, not invented');
});

await ok(() => {
  const index = JSON.parse(readFileSync(`${root}functions/ask/_data/guides-index.json`, 'utf8'));
  assert.ok(embeddingModelInfo(index.model), `the committed index uses a known model (${index.model})`);
  const sizes = new Set(index.chunks.map((c) => c.embedding.length));
  assert.equal(sizes.size, 1, 'one vector size across the whole index');
  const questions = JSON.parse(readFileSync(`${root}scripts/eval-data/retrieval-questions.json`, 'utf8'));
  const slugs = new Set(index.chunks.map((c) => c.slug));
  for (const item of questions.onTopic) for (const slug of item.slugs) assert.ok(slugs.has(slug), `eval question points at a real guide: ${slug}`);
});

await ok(() => {
  const run = (...args) => spawnSync(process.execPath, [`${root}scripts/build-guides-index.mjs`, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  const dry = run('--dry-run');
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /Dry run: \d+ chunks .* @cf\/baai\/bge-m3\. Nothing written\./);
  assert.equal(run('--model=bogus').status, 1, 'unknown model refused');
  const noCreds = run();
  assert.equal(noCreds.status, 1);
  assert.match(noCreds.stderr, /CLOUDFLARE_ACCOUNT_ID/, 'the default no longer needs a Gemini key');
  const gem = run('--model=gemini-embedding-001');
  assert.equal(gem.status, 1);
  assert.match(gem.stderr, /GEMINI_API_KEY/);
});

// Wiring: every provider call goes through the shared helper, nothing puts a key in a URL.
await ok(() => {
  const read = (p) => readFileSync(`${root}${p}`, 'utf8');
  const chat = read('functions/ask/api/chat.js');
  assert.ok(chat.includes('groqChat(') && chat.includes('geminiGenerate(') && chat.includes('embedText('));
  assert.ok(chat.includes('guidesIndex.model'), 'the live query uses the index\'s own model');
  assert.ok(!chat.includes('if(!env.GEMINI_API_KEY)return json({answer:UNAVAILABLE_ANSWER'), 'Ask no longer needs a Gemini key when Groq is configured');
  for (const file of ['functions/internal/api/lead-analyzer.js', 'functions/internal/api/copilot.js', 'functions/internal/api/copilot-summary.js']) {
    const text = read(file);
    assert.ok(text.includes('ai-gateway.mjs'), `${file} uses the shared helper`);
    assert.ok(!/api\.groq\.com|generativelanguage\.googleapis\.com/.test(text), `${file} has no direct provider URL`);
  }
  for (const file of ['functions/ask/api/chat.js', 'functions/ask/api/models.js', 'functions/_lib/ai-gateway.mjs', 'functions/ask/_lib/embeddings.mjs']) {
    assert.ok(!/[?&]key=/.test(read(file)), `${file} never puts an API key in a URL`);
  }
});

console.log(`embeddings and gateway: ok (${groups} groups)`);
