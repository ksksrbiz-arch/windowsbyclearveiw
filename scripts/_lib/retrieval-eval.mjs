// Scores how well a guide index answers a fixed question set. Pure: `embed` is injected, so the
// same code runs against a live model in the CLI and against a fake in tests.
import { cosineSimilarity } from '../../functions/ask/_lib/rag.mjs';

function rank(vector, chunks) {
  return chunks
    .filter((chunk) => chunk.embedding.length === vector.length)
    .map((chunk) => ({ slug: chunk.slug, id: chunk.id, score: cosineSimilarity(vector, chunk.embedding) }))
    .sort((a, b) => b.score - a.score);
}

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
};
const round = (n) => (n === null ? null : Math.round(n * 1000) / 1000);

export async function evaluateRetrieval({ questions, chunks, embed, minScore, k = 6 }) {
  const on = [];
  for (const item of questions.onTopic) {
    const ranked = rank(await embed(item.q), chunks);
    const firstHit = ranked.findIndex((r) => item.slugs.includes(r.slug));
    on.push({ q: item.q, best: ranked[0]?.score ?? 0, topSlug: ranked[0]?.slug, rankOfExpected: firstHit === -1 ? null : firstHit + 1 });
  }
  const off = [];
  for (const q of questions.offTopic) {
    const ranked = rank(await embed(q), chunks);
    off.push({ q, best: ranked[0]?.score ?? 0, topSlug: ranked[0]?.slug });
  }
  const hitAt = (n) => on.filter((r) => r.rankOfExpected !== null && r.rankOfExpected <= n).length / on.length;
  const onBest = on.map((r) => r.best);
  const offBest = off.map((r) => r.best);
  // The floor should sit above the best an unrelated question ever scores and below the weakest
  // on-topic best; when the two ranges overlap there is no clean floor and the report says so.
  const lowestOn = Math.min(...onBest);
  const highestOff = Math.max(...offBest);
  const separable = lowestOn > highestOff;
  const summary = {
    onTopicQuestions: on.length,
    offTopicQuestions: off.length,
    hitAt1: round(hitAt(1)),
    hitAt3: round(hitAt(3)),
    hitAtK: round(hitAt(k)),
    onTopicBestScore: { min: round(lowestOn), p10: round(percentile(onBest, 0.1)), median: round(percentile(onBest, 0.5)) },
    offTopicBestScore: { max: round(highestOff), p90: round(percentile(offBest, 0.9)), median: round(percentile(offBest, 0.5)) },
    separable,
    suggestedMinScore: separable ? round((lowestOn + highestOff) / 2) : null,
  };
  if (typeof minScore === 'number') {
    summary.atMinScore = {
      minScore,
      onTopicCited: round(on.filter((r) => r.best >= minScore).length / on.length),
      offTopicCited: round(off.filter((r) => r.best >= minScore).length / off.length),
    };
  }
  return { summary, onTopic: on, offTopic: off };
}
