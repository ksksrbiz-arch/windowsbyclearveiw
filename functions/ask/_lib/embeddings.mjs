// Turns text into vectors for the guide search. One place decides which model is used, so the
// committed index and the live query can never silently disagree: the index file records the
// model that built it (guides-index.json "model") and the live query is embedded with that same
// model. Cosine similarity between vectors from different models is meaningless.
//
//   gemini-embedding-001   Gemini API, needs GEMINI_API_KEY (the original index)
//   @cf/baai/bge-m3        Cloudflare Workers AI through the `AI` binding: no external key,
//                          $0.0118 per million input tokens (Cloudflare pricing page), 60,000
//                          token context; the preferred model for new indexes
//
// minScore is the cosine floor below which a guide chunk is not cited. It is a property of the
// model's score distribution, not a universal constant: re-measure it with
// `npm run eval:retrieval` whenever a model is added or the index is rebuilt with another model.

export const DEFAULT_EMBEDDING_MODEL = '@cf/baai/bge-m3';

export const EMBEDDING_MODELS = Object.freeze({
  'gemini-embedding-001': { provider: 'gemini', minScore: 0.48 },
  // Provisional until measured against the real index (see docs on npm run eval:retrieval).
  '@cf/baai/bge-m3': { provider: 'workers-ai', minScore: 0.48 },
});

export const embeddingModelInfo = (model) => EMBEDDING_MODELS[model] || null;

/** Pulls one vector out of whichever shape Workers AI returned; throws if it is not a vector. */
export function vectorFromWorkersAi(result) {
  const rows = result?.data ?? result?.response ?? result?.embeddings;
  const vector = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : null;
  if (!vector || !vector.length || !vector.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error('Workers AI returned no embedding.');
  }
  return vector;
}

/**
 * Embeds one text with `model`. `env` supplies the credentials: `env.AI` (Workers AI binding, or
 * anything with .run(model, input)) or `env.GEMINI_API_KEY`. Throws on any failure; callers treat
 * a failed embedding as "no guide matches", never as a failed answer.
 */
export async function embedText(env, text, model, fetchImpl = fetch) {
  const info = embeddingModelInfo(model);
  if (!info) throw new Error(`Unknown embedding model: ${model}`);
  if (info.provider === 'workers-ai') {
    if (!env?.AI?.run) throw new Error('Workers AI binding (AI) is not configured.');
    return vectorFromWorkersAi(await env.AI.run(model, { text: [text] }));
  }
  if (!env?.GEMINI_API_KEY) throw new Error('Gemini is not configured.');
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ content: { parts: [{ text }] } }),
  });
  if (!response.ok) throw new Error(`Gemini embed ${response.status}`);
  const values = (await response.json())?.embedding?.values;
  if (!Array.isArray(values) || !values.length) throw new Error('Gemini returned no embedding.');
  return values;
}

/** An `AI`-binding look-alike over Cloudflare's REST API, for scripts that run outside a Worker. */
export function restAiBinding({ accountId, apiToken, fetchImpl = fetch }) {
  return {
    async run(model, input) {
      const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.success === false) throw new Error(`Workers AI REST ${response.status}: ${JSON.stringify(body?.errors || body).slice(0, 200)}`);
      return body.result;
    },
  };
}
