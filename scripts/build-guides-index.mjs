#!/usr/bin/env node
// Generates functions/ask/_data/guides-index.json — the embedded chunks the
// /ask chatbot retrieves against. Run by hand after editing a guide:
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... npm run build:guides-index
//   (default model @cf/baai/bge-m3 on Cloudflare Workers AI; the token needs "Workers AI - Read")
//
//   GEMINI_API_KEY=... npm run build:guides-index -- --model=gemini-embedding-001
//   (the original model; still supported)
//
//   npm run build:guides-index -- --dry-run     lists the chunks, no network, writes nothing
//
// Not run automatically at build time: guide content changes rarely, and a deploy must never
// depend on an embedding service being up. The index records which model built it, and the live
// /ask query is embedded with that same model (functions/ask/_lib/embeddings.mjs). After changing
// models, run `npm run eval:retrieval` and set minScore for the model before shipping the index.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { DEFAULT_EMBEDDING_MODEL, embedText, embeddingModelInfo, restAiBinding } from '../functions/ask/_lib/embeddings.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUIDES_DIR = join(__dirname, '../src/content/guides');
const OUTPUT_DIR = join(__dirname, '../functions/ask/_data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'guides-index.json');
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const EMBED_MODEL = (args.find((arg) => arg.startsWith('--model=')) || `--model=${DEFAULT_EMBEDDING_MODEL}`).slice('--model='.length);
const modelInfo = embeddingModelInfo(EMBED_MODEL);
if (!modelInfo) {
  console.error(`Unknown embedding model "${EMBED_MODEL}". Use @cf/baai/bge-m3 or gemini-embedding-001.`);
  process.exit(1);
}

function embeddingEnv() {
  if (modelInfo.provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      console.error('Set GEMINI_API_KEY first (https://aistudio.google.com/apikey), or use the default Workers AI model.');
      process.exit(1);
    }
    return { GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  }
  const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
  if (!accountId || !apiToken) {
    console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (permission: Workers AI - Read) first.');
    process.exit(1);
  }
  return { AI: restAiBinding({ accountId, apiToken }) };
}

/** Splits a guide body into one chunk per H2 section, plus an intro chunk
 *  for anything (title, description, opening paragraph) before the first
 *  H2. Small enough guides that finer chunking would not help retrieval. */
function chunkGuide(slug, frontmatter, body) {
  const sections = body
    .split(/\n(?=## )/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  const intro = sections.length && !sections[0].startsWith('## ') ? sections.shift() : null;
  const introText = [frontmatter.title, frontmatter.description, intro].filter(Boolean).join('\n\n');
  chunks.push({ heading: frontmatter.title, text: introText });

  for (const section of sections) {
    const headingMatch = section.match(/^## (.+)$/m);
    chunks.push({ heading: headingMatch ? headingMatch[1] : frontmatter.title, text: section });
  }

  return chunks.map((c, i) => ({
    id: `${slug}#${i}`,
    slug,
    title: frontmatter.title,
    topic: frontmatter.topic,
    heading: c.heading,
    text: c.text,
    url: `/guides/${slug}`,
  }));
}

async function main() {
  const files = readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.md'));
  const allChunks = [];

  for (const file of files) {
    const raw = readFileSync(join(GUIDES_DIR, file), 'utf-8');
    const { data: frontmatter, content: body } = matter(raw);
    if (frontmatter.published === false) continue;
    const slug = file.replace(/\.md$/, '');
    allChunks.push(...chunkGuide(slug, frontmatter, body));
  }

  if (DRY_RUN) {
    console.log(`Dry run: ${allChunks.length} chunks from ${files.length} guide file(s), model ${EMBED_MODEL}. Nothing written.`);
    return;
  }
  const env = embeddingEnv();
  console.log(`Embedding ${allChunks.length} chunks from ${files.length} guide file(s) with ${EMBED_MODEL}...`);
  const indexed = [];
  for (const chunk of allChunks) {
    const embedding = await embedText(env, `${chunk.heading}\n\n${chunk.text}`, EMBED_MODEL);
    if (indexed.length && embedding.length !== indexed[0].embedding.length) throw new Error('Embedding sizes differ between chunks; refusing to write a mixed index.');
    indexed.push({ ...chunk, embedding });
    process.stdout.write('.');
  }
  console.log('\nDone.');

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    OUTPUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), model: EMBED_MODEL, chunks: indexed }),
  );
  console.log(`Wrote ${indexed.length} chunks to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
