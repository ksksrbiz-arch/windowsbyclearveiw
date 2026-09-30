/**
 * Pure helpers for handing an /ask conversation over to a person.
 *
 * Kept free of DOM and framework imports so the same code runs in the page and
 * in `scripts/test-ask-handoff.mjs` (Node strips the types). Only erasable
 * TypeScript is used here for that reason: no enums, no parameter properties.
 */

export type AskProjectKey = 'homeType' | 'count' | 'openingType' | 'concern' | 'projectStage';
export type AskProject = Partial<Record<AskProjectKey, string>>;
export type AskMessage = { role: 'user' | 'assistant'; content: string };

/** Project details in the order they are shown to a person reading the lead. */
const NOTE_LABELS: ReadonlyArray<readonly [AskProjectKey, string]> = [
  ['homeType', 'Home type'],
  ['count', 'Approximate openings'],
  ['openingType', 'Opening type'],
  ['concern', 'Main concern'],
  ['projectStage', 'Project stage'],
];

/**
 * Query keys understood by EstimateForm.astro's pre-fill. Changing a name here
 * means changing it there too.
 */
const QUERY_KEYS: ReadonlyArray<readonly [AskProjectKey, string]> = [
  ['homeType', 'home_type'],
  ['count', 'openings'],
  ['openingType', 'opening_type'],
  ['concern', 'concern'],
  ['projectStage', 'stage'],
];

const FIELD_MAX = 80;
const QUESTION_MAX = 160;
const QUESTIONS_SHOWN = 5;
/** /api/estimate truncates notes at 2000 characters; stay comfortably under. */
export const LEAD_NOTES_MAX = 1800;

function tidy(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Query string for `/estimate` carrying what the visitor told the consultant.
 * Returns '' when there is nothing to carry, otherwise a string starting '?'.
 */
export function buildEstimateQuery(project: AskProject): string {
  const params = new URLSearchParams();
  for (const [key, param] of QUERY_KEYS) {
    const value = tidy(project[key], FIELD_MAX);
    if (value) params.set(param, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Plain-text project notes for a lead: the project details the visitor chose,
 * then their own recent questions, so a person can see what they were asking
 * about before calling. Assistant replies are deliberately left out.
 */
export function buildLeadNotes(
  project: AskProject,
  conversation: ReadonlyArray<AskMessage>,
  max: number = LEAD_NOTES_MAX,
): string {
  const lines: string[] = [];
  for (const [key, label] of NOTE_LABELS) {
    const value = tidy(project[key], FIELD_MAX);
    if (value) lines.push(`${label}: ${value}`);
  }

  const questions = conversation
    .filter((message) => message.role === 'user')
    .map((message) => tidy(message.content, QUESTION_MAX + 1))
    .filter(Boolean)
    .slice(-QUESTIONS_SHOWN)
    .map((question) => `- ${clip(question, QUESTION_MAX)}`);
  if (questions.length) lines.push('', 'Asked the website consultant:', ...questions);

  return clip(lines.join('\n').trim(), max);
}

/** Where a visitor went after the consultant. Mirrors the server allowlist. */
export type HandoffKind = 'estimate' | 'call' | 'callback_open';
export const HANDOFF_KINDS: ReadonlyArray<HandoffKind> = ['estimate', 'call', 'callback_open'];

export function isHandoffKind(value: unknown): value is HandoffKind {
  return typeof value === 'string' && (HANDOFF_KINDS as ReadonlyArray<string>).includes(value);
}
