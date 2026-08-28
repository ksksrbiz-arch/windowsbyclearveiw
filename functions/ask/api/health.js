import guidesIndex from '../_data/guides-index.json';

// Reports whether the two keys /ask depends on are visible to the Function
// at runtime — never their values — plus how many guide chunks are indexed.
// Exists because chat.js's own error messages can't distinguish "no key
// set" from "key set but the API call is failing" without this: both
// surface as the same friendly fallback text on purpose, so a visitor
// never sees a raw error.
export async function onRequestGet(context) {
  const { env } = context;
  return new Response(
    JSON.stringify({
      groqKeyPresent: Boolean(env.GROQ_API_KEY),
      geminiKeyPresent: Boolean(env.GEMINI_API_KEY),
      guideChunksIndexed: guidesIndex.chunks.length,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } },
  );
}
