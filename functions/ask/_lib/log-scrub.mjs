// What /ask keeps of a conversation, and for how long.
//
// Each turn is logged to D1 (`ask_logs`) so the owner can see what visitors ask and where the
// consultant falls short. The question and answer are stored only after scrubbing, and only for
// ASK_LOG_RETENTION_DAYS. Scrubbing is best effort: it removes the contact details a visitor is
// most likely to type (phone, email, link, street address, ZIP, long digit runs, "my name is …"),
// not every possible identifier. The privacy policy says so and tells visitors not to type them.
//
// Three places enforce the retention window so it never depends on one of them running:
//   functions/ask/api/chat.js           deletes expired rows on every insert
//   functions/internal/api/ask-logs.js  never returns an expired row
//   workers/ops-cron                    deletes expired rows nightly and keeps the text out of backups

export const ASK_LOG_RETENTION_DAYS = 30;
export const MAX_LOGGED_QUESTION = 500;
export const MAX_LOGGED_ANSWER = 3000;

/** Marker the logger wrote before question text was stored; those rows carry no words. */
export const LEGACY_REDACTED = '[redacted]';

/** ISO timestamp of the oldest ask_logs row still inside the retention window. */
export function askLogCutoff(now = Date.now(), days = ASK_LOG_RETENTION_DAYS) {
  return new Date(Number(now) - days * 24 * 60 * 60 * 1000).toISOString();
}

// Words that can sit between a house number and a street suffix without being a street name
// ("2 windows by the way", "36 inches wide way").
const NOT_STREET = '(?!(?:windows?|doors?|inch(?:es)?|feet|foot|ft|units?|openings?|panes?|sliders?|of|by|the|and|to|for|in|on|at|wide|tall|high)\\b)';
const STREET_SUFFIX = '(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|terrace|ter|highway|hwy|loop|trail|trl|parkway|pkwy)';
const ADDRESS = new RegExp(
  `\\b\\d{1,6}\\s+(?:(?:[NS][EW]?|[EW])\\.?\\s+)?(?:${NOT_STREET}[A-Za-z0-9'.-]+\\s+){0,3}?${STREET_SUFFIX}\\b\\.?`,
  'gi',
);

const RULES = [
  [/\b(?:https?:\/\/|www\.)\S+/gi, '[link]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g, '[phone]'],
  [/(?<!\d)\d{3}[\s.-]\d{4}(?!\d)/g, '[phone]'],
  [/\bP\.?\s?O\.?\s*Box\s*\d+/gi, '[address]'],
  [ADDRESS, '[address]'],
  [/\b((?:OR|WA|Oregon|Washington)\b[,.]?\s+)\d{5}(?:-\d{4})?\b/g, '$1[zip]'],
  [/\b(zip(?:\s?code)?\s*(?:is|:)?\s*)\d{5}(?:-\d{4})?\b/gi, '$1[zip]'],
  [/(?<!\d)\d(?:[\s-]?\d){8,}(?!\d)/g, '[number]'],
  [/\b((?:[Mm]y name(?: is|'s)|[Nn]ame is|[Cc]all me|[Tt]his is|[Ii]'m|[Ii] am)\s+)[A-Z][a-z'-]+(?:\s+(?:[A-Z]\.|[A-Z](?=\s+[A-Z][a-z])|[A-Z][a-z'-]+)){0,2}/g, '$1[name]'],
];

/** Scrubs contact details out of `text`, collapses whitespace and caps the length. */
export function scrubForLog(text, maxLength) {
  let out = String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ');
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > maxLength ? `${out.slice(0, maxLength - 1).trimEnd()}…` : out;
}

/** Writes one scrubbed turn to ask_logs, then deletes every row past the retention window.
 *  Best effort by design: a logging failure must never cost the visitor their answer. */
export async function recordAskTurn(db, entry, now = Date.now()) {
  if (!db) return;
  try {
    await db
      .prepare('INSERT INTO ask_logs (created_at, question, answer, model_used, tools_used, sources, match_count, refused) VALUES (?,?,?,?,?,?,?,?)')
      .bind(
        new Date(now).toISOString(),
        scrubForLog(entry.question, MAX_LOGGED_QUESTION),
        scrubForLog(entry.answer, MAX_LOGGED_ANSWER),
        entry.modelUsed,
        JSON.stringify(entry.toolsUsed),
        JSON.stringify(entry.sources),
        entry.matchCount,
        entry.refused ? 1 : 0,
      )
      .run();
  } catch (error) {
    console.error('ask_logs insert failed:', error?.message || error);
  }
  try {
    await db.prepare('DELETE FROM ask_logs WHERE created_at < ?').bind(askLogCutoff(now)).run();
  } catch (error) {
    console.error('ask_logs purge failed:', error?.message || error);
  }
}
