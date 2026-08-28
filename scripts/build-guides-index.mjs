#!/usr/bin/env node
// Generates functions/ask/_data/guides-index.json — the embedded chunks the
// /ask chatbot retrieves against. Run by hand after editing a guide:
//
//   GEMINI_API_KEY=... node scripts/build-guides-index.mjs
//
// Not run automatically at build time: it calls a paid... well free-tier,
// but rate-limited, external API, and guide content changes rarely. A
// build-time dependency on Gemini being up would mean an unrelated outage
// blocks every deploy. Free key: https://aistudio.google.com/apikey
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GUIDES_DIR = join(__dirname, '../src/content/guides');
const OUTPUT_DIR = join(__dirname, '../functions/ask/_data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'guides-index.json');
// Must match EMBED_MODEL in functions/ask/api/chat.js — the index and the
// live query embedding have to come from the same model or cosine
// similarity between them is meaningless.
const EMBED_MODEL = 'gemini-embedding-001';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('Set GEMINI_API_KEY first. Get a free key at https://aistudio.google.com/apikey');
  process.exit(1);
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

async function embed(text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    },
  );
  if (!res.ok) {
    throw new Error(`Embedding request failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.embedding.values;
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

  console.log(`Embedding ${allChunks.length} chunks from ${files.length} guide file(s)...`);
  const indexed = [];
  for (const chunk of allChunks) {
    const embedding = await embed(`${chunk.heading}\n\n${chunk.text}`);
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
