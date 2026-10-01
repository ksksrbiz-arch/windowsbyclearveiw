# Workflow: Analytics events (GA4 / GTM / Meta)

Add, change or verify a tracked event so the numbers Mark reads are true.

## Load / exclude

| Load | Do not load |
|---|---|
| `internal/README.md` → "Analytics" section (GA4 Data API setup) | copy references, specialists |
| `functions/internal/api/analytics.js`, `src/lib/charts.ts` (view layer) | `.ai/workflows/build-plan/` |
| `functions/ask/api/handoff.js` (Ask hand-off counting) | |

## Input

An event to add or fix. Known events: `generate_lead` (including `method: ask_callback`) and `ask_handoff`
(its GTM tag is set up and tested by the owner, 2026-09-30). Meta pixel ownership and the GA4 Lead-event
fix are owner-account items; GA4 is readable by the skdev account. Their current status is not recorded here.

## Process

1. State the question the event answers and where it is read (GA4, `/internal/analytics`, `/internal/ask-logs`).
2. D1 counts are the truth for pipeline numbers; GA4 is traffic only. Do not duplicate a D1 fact into GA4.
3. Send no personal data in events. Hand-off counts store kind + timestamp only.
4. Implement the event in code; GTM changes are made by the owner, so list the exact tag, trigger and variable
   needed as `VERIFY` instead of assuming it exists.
5. Confirm in GA4 DebugView (owner) or via the GA4 Data API that the event arrives with the expected parameters.

## Output

The event in code, a note of the GTM/Meta setup the owner must do, and the measured result of the check.

## Stop conditions

An event would carry personal data; the Meta pixel is under Mark's personal Facebook account and needs his
action; GA4 or GTM access is missing; a change would alter an existing event name that reports depend on.

## Completion

Done when `npm run test:analytics` and `npm run test:ask-handoff` pass locally, the owner has confirmed the event
in GA4, and the setup steps left for the owner are written down. Never report an event as working from code alone.
