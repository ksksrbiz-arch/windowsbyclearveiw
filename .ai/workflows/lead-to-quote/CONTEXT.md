# Workflow: Website inquiry → quote

Take a new lead from the estimate form (or Ask call-back) to a quote Mark can send and a customer can sign.
Upstream of `build-plan`: this workflow ends where the Build Plan begins.

## Load / exclude

| Load | Do not load |
|---|---|
| `functions/api/estimate.js`, `functions/_lib/lead-alert.mjs` (intake) | `.ai/workflows/build-plan/` stages until a quote exists |
| `functions/internal/api/quote-lead.js`, `functions/internal/_lib/lead-links.mjs` | public copy references |
| `functions/internal/_lib/quote-follow-ups.mjs`, `functions/internal/_lib/quote-signing.mjs` | |
| `.ai/specialists/lead-analyzer/CONTEXT.md` (advisory analysis only) | |

## Input

A lead record in D1 (`leads`), created by `/api/estimate` (roles include homeowner, builder, `Ask assistant`).
Validation, rate limits and the customer receipt are deterministic and already enforced in code.

## Process

1. **Alert.** A valid lead triggers a PII-free push (off unless `LEAD_ALERT_NTFY_TOPIC` is set) and the email to Mark.
2. **Review (human + optional AI).** Mark opens the lead. Lead Analyzer may summarize and list what is missing; its
   output is advisory and tagged `KNOWN` / `INFERRED` / `VERIFY`. Page-view behavior is not proof of intent.
3. **Start quote.** *Start quote* sets `quotes.lead_id`. A match by exact phone/email may be suggested, and only
   Mark confirms it; the system never auto-links.
4. **Quote.** Items, quantities and prices come from Mark and the pricing model, never from AI.
5. **Follow-up.** Unsigned draft quotes get day 2/7/14 reminder tasks; they never contact the customer.
6. **Build Plan, then finalize.** Hand off to `.ai/workflows/build-plan/`. A quote cannot be finalized without an
   approved, current Build Plan.
7. **Sign.** A customer signing link (`/sign#<token>`) passes the same Build Plan and terms gates.

## Output

A finalized, signed quote linked to its lead, ready to become a Job (see `job-closeout`).

## Stop conditions

Lead data is missing a fact needed for pricing; two leads match one quote; the quote changed after plan approval
(re-approve first); any attempt to state a price, credential or commitment that Mark has not entered.

## Completion

Done when the quote is signed and `quotes.lead_id` is set (or Mark deliberately left it unlinked). Code paths are
verified by `npm run test:estimate`, `test:lead-links`, `test:quote-follow-ups`, `test:quote-signing` and
`test:quote-to-job`. A human (Mark) sends and finalizes; AI never does.
