#!/usr/bin/env node
// Before/after quality check for the guide index.
//
//   node scripts/eval-retrieval.mjs                       the committed index, with its own model
//   node scripts/eval-retrieval.mjs --index=new.json      another index file
//   node scripts/eval-retrieval.mjs --index=old.json --against=new.json    side by side
//
// Questions come from scripts/eval-data/retrieval-questions.json. Each question is embedded with
// the model recorded in the index being scored. Credentials as for build:guides-index
// (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN for Workers AI, GEMINI_API_KEY for Gemini).
// Reports hit rates, the score ranges for on- and off-topic questions, and a suggested minScore.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embedText, embeddingModelInfo, restAiBinding } from '../functions/ask/_lib/embeddings.mjs';
import { evaluateRetrieval } from './_lib/retrieval-eval.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const arg = (name) => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const load = (path) => JSON.parse(readFileSync(path, 'utf8'));
const questions = load(`${root}scripts/eval-data/retrieval-questions.json`);

function envFor(model) {
  const info = embeddingModelInfo(model);
  if (!info) throw new Error(`Index uses an unknown model: ${model}`);
  if (info.provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY to score a Gemini index.');
    return { GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  }
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
  if (!accountId || !apiToken) throw new Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to score a Workers AI index.');
  return { AI: restAiBinding({ accountId, apiToken }) };
}

async function score(path) {
  const index = load(path);
  const env = envFor(index.model);
  const minScore = embeddingModelInfo(index.model).minScore;
  const result = await evaluateRetrieval({ questions, chunks: index.chunks, embed: (text) => embedText(env, text, index.model), minScore });
  return { path, model: index.model, generatedAt: index.generatedAt, chunks: index.chunks.length, ...result };
}

const paths = [arg('index') || `${root}functions/ask/_data/guides-index.json`, arg('against')].filter(Boolean);
try {
  for (const path of paths) {
    const r = await score(path);
    console.log(`\n${r.path}\n  model ${r.model}, ${r.chunks} chunks, built ${r.generatedAt}`);
    console.log(JSON.stringify(r.summary, null, 2));
    const misses = r.onTopic.filter((q) => q.rankOfExpected === null || q.rankOfExpected > 3);
    if (misses.length) console.log('  on-topic questions whose guide is not in the top 3:\n' + misses.map((m) => `   - ${m.q} (best: ${m.topSlug}, ${m.best.toFixed(3)})`).join('\n'));
    const leaks = r.offTopic.filter((q) => r.summary.atMinScore && q.best >= r.summary.atMinScore.minScore);
    if (leaks.length) console.log('  off-topic questions that would cite a guide at the current minScore:\n' + leaks.map((m) => `   - ${m.q} (${m.topSlug}, ${m.best.toFixed(3)})`).join('\n'));
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
