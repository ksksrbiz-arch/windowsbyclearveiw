// TEMPORARY diagnostic route. Lists available model ids from Groq and
// Gemini using the real keys server-side, so the hardcoded model names in
// chat.js can be corrected to whatever is actually current — never
// returns the key values themselves. Remove once chat.js is confirmed
// working end to end.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function onRequestGet(context) {
  const { env } = context;
  const out = {};

  if (env.GROQ_API_KEY) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { authorization: `Bearer ${env.GROQ_API_KEY}` },
      });
      const data = await res.json();
      out.groq = res.ok ? (data.data || []).map((m) => m.id) : { status: res.status, body: JSON.stringify(data).slice(0, 500) };
    } catch (err) {
      out.groq = { error: String(err?.message || err) };
    }
  } else {
    out.groq = 'no key';
  }

  if (env.GEMINI_API_KEY) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`);
      const data = await res.json();
      out.gemini = res.ok
        ? (data.models || []).map((m) => ({ name: m.name, methods: m.supportedGenerationMethods }))
        : { status: res.status, body: JSON.stringify(data).slice(0, 500) };
    } catch (err) {
      out.gemini = { error: String(err?.message || err) };
    }
  } else {
    out.gemini = 'no key';
  }

  return json(out);
}
