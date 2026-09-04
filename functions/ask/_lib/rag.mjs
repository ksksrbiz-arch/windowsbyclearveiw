export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Ranks the guide chunks against a question's embedding and keeps the ones
 * worth citing. minScore is a floor tuned against text-embedding-004's
 * typical range for this corpus (small — under 30 chunks) — an on-topic
 * question usually clears 0.6+, unrelated ones sit well below 0.5. Widen it
 * if real questions start coming back with no matches; tighten it if
 * off-topic questions are pulling in irrelevant guide text.
 */
export function topMatches(queryEmbedding, chunks, k = 4, minScore = 0.5) {
  return chunks
    .map((chunk) => ({ ...chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((chunk) => chunk.score >= minScore);
}
