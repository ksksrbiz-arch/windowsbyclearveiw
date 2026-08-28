// Lists available model ids from Groq and Gemini using the real keys
// server-side — never the key values themselves. Kept permanently, not
// removed after the model-name fix in chat.js: this space drifts fast
// (both Groq's chat model and two different Gemini model names 404'd
// within months of being picked), so when chat.js starts answering
// "unavailable" again, check here first before guessing at a new name.
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
