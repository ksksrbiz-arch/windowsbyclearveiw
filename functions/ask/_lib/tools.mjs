import { estimatePrice, PRICING } from './pricing.mjs';
import { webSearch } from './search.mjs';

const OPENING_IDS = PRICING.openings.map((o) => o.id);
const MATERIAL_IDS = PRICING.materials.map((m) => m.id);
const BRAND_IDS = PRICING.brands.map((b) => b.id);
const MODIFIER_IDS = PRICING.modifiers.map((m) => m.id);

// Provider-agnostic tool definitions — lowercase JSON-Schema style,
// converted per-provider below. Descriptions are written for the model,
// not for a human reading the code: they're what decides whether/when it
// reaches for a tool.
export const TOOL_DEFS = [
  {
    name: 'estimate_price',
    description:
      "Calculates a real price range from Clearveiw's own published pricing model — the exact same numbers and formula as /tools/window-replacement-cost-calculator. Use this whenever a visitor describes a job and wants a sense of cost. Never state a price without calling this — never estimate from memory or general knowledge.",
    parameters: {
      type: 'object',
      properties: {
        lines: {
          type: 'array',
          description: 'One entry per opening type in the job.',
          items: {
            type: 'object',
            properties: {
              openingId: { type: 'string', enum: OPENING_IDS, description: 'Opening type id.' },
              quantity: { type: 'integer', description: 'How many of this opening type.' },
            },
            required: ['openingId', 'quantity'],
          },
        },
        materialId: { type: 'string', enum: MATERIAL_IDS, description: 'Defaults to vinyl if not specified.' },
        brandId: { type: 'string', enum: BRAND_IDS, description: 'Window line; defaults to cascade (the standard line) if not specified.' },
        method: {
          type: 'string',
          enum: ['insert', 'full-frame', 'mixed'],
          description: 'insert if frames are sound, full-frame if rotten/out of square, mixed if unsure — defaults to insert.',
        },
        modifierIds: {
          type: 'array',
          items: { type: 'string', enum: MODIFIER_IDS },
          description: 'Any that apply: third-story-plus, oversize, trim, metal-removal. Omit if none mentioned.',
        },
      },
      required: ['lines'],
    },
  },
  {
    name: 'search_web',
    description:
      'Searches the web for general window/construction industry knowledge — terminology, how methods or materials work, current rebate programs, building codes, energy standards. Do NOT use this for anything about Clearveiw Windows itself (its policies, pricing, claims, reviews) — that must only ever come from the reference material already provided.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A focused search query.' },
      },
      required: ['query'],
    },
  },
];

function toGeminiSchema(schema) {
  if (schema.type === 'array') {
    return { type: 'ARRAY', description: schema.description, items: toGeminiSchema(schema.items) };
  }
  if (schema.type === 'object') {
    const properties = {};
    for (const [key, value] of Object.entries(schema.properties)) properties[key] = toGeminiSchema(value);
    return { type: 'OBJECT', description: schema.description, properties, required: schema.required };
  }
  const typeMap = { string: 'STRING', integer: 'INTEGER', number: 'NUMBER', boolean: 'BOOLEAN' };
  return { type: typeMap[schema.type] || 'STRING', description: schema.description, enum: schema.enum };
}

export function toolsForGroq() {
  return TOOL_DEFS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

export function toolsForGemini() {
  return [{ functionDeclarations: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.parameters) })) }];
}

/** Executes one named tool call and returns a plain result object — never
 *  throws, so one bad/failed tool call can't take down the whole turn. */
export async function runTool(name, args) {
  try {
    if (name === 'estimate_price') return estimatePrice(args || {});
    if (name === 'search_web') {
      const results = await webSearch(String(args?.query || ''));
      return results.length ? { results } : { results: [], note: 'No web results found.' };
    }
    return { error: `Unknown tool "${name}".` };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}
