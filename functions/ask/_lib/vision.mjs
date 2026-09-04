// Cloudflare Workers AI, via the `AI` binding — free up to 10,000 Neurons/day
// with no billing setup. Only called when a visitor attaches a photo on /ask;
// it never runs on a text-only turn. This module SEES the photo (a factual
// description of what's visible); it never advises. Cost/scope/diagnosis
// synthesis stays with the main chat model, which already carries the
// tiered-authority guardrails in chat.js's SYSTEM_PROMPT — keeping that split
// means this file can't accidentally say something the guardrails would have
// blocked.
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

// Bounds the request Workers AI actually has to decode, independent of the
// client's own resize step — the client can't be trusted to have run at all.
// Exported so chat.js's own pre-parse size gate stays in the same units as
// this one instead of a second hand-picked number that can drift out of sync.
export const MAX_IMAGE_BYTES = 500_000;

const VISION_PROMPT = `
You are looking at a photo a homeowner took of a window, door, or the outside of their house, for a window-replacement contractor's chatbot. Describe only what is visibly true in the photo — frame material and color if it can be told (vinyl, wood, aluminum, fiberglass), window style (double-hung, slider, casement, picture, bay), visible condensation or fog between panes, visible damage, rot, or gaps, and any siding or trim context that looks relevant to a replacement job.

Do not give advice, a cost, a diagnosis, or a recommendation — only describe what you see, in two or three short sentences. If the photo is not a window, door, or house exterior, say so plainly instead of guessing.
`.trim();

function decodeDataUrl(dataUrl) {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl || '');
  if (!match) return null;
  try {
    const bytes = atob(match[2]);
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
    return out;
  } catch {
    // Malformed base64 — atob() throws rather than returning null.
    return null;
  }
}

/** Describes a photo attached to an /ask turn. Never throws — returns
 *  { error } on any failure (binding missing, quota exhausted, bad image)
 *  so a vision hiccup degrades the chat turn rather than failing it. */
export async function analyzePhoto(imageDataUrl, env) {
  if (!env.AI) return { error: 'Photo analysis is not configured on this deployment.' };

  const bytes = decodeDataUrl(imageDataUrl);
  if (!bytes) return { error: 'That image could not be read — try a smaller photo.' };

  try {
    const result = await env.AI.run(VISION_MODEL, {
      image: Array.from(bytes),
      prompt: VISION_PROMPT,
      max_tokens: 256,
    });
    const description = String(result?.description ?? result?.response ?? '').trim();
    if (!description) return { error: 'Photo analysis returned nothing usable.' };
    return { description };
  } catch (err) {
    // Most common real cause: the free daily Neuron allocation is spent.
    return { error: String(err?.message || err) };
  }
}
