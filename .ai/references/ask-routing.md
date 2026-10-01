# Ask routing (reference)

Load this before changing `/ask` routing, specialist contracts, or the Ask system context.
Moved from the root `CLAUDE.md` on 2026-10-01 so the root file can stay routing-only.

## The seam

`functions/ask/_lib/icm-router.mjs` is the deterministic Layer-1 routing seam for `/ask`. It runs before
retrieval/model generation and selects exactly one specialist contract from the public Ask context.

| Route | Handles |
|---|---|
| `diagnostician` | symptoms, visible damage, moisture, drafts |
| `estimator` | price, budget, estimate/quote requests |
| `installation-reviewer` | installation, flashing, opening preparation, new construction |
| `customer-advisor` | comparisons, performance, appearance, planning |

Internal-only routes (`lead-analyzer`, `evidence-reviewer`, `operations-copilot`, `knowledge-assistant`,
`visualizer`) are opt-in with `surface: 'internal'` and must never be reachable from public Ask.

## Canonical vs runtime contracts

- `.ai/specialists/*/CONTEXT.md` is the canonical human-agent context.
- `functions/ask/_lib/icm-specialists.mjs` supplies the small runtime contract the router selects. It holds
  bounded execution summaries only, not a second technical knowledge base.

## What the selected contract does and does not do

- It is injected into the same system context used by Groq/Gemini.
- It does not bypass RAG, business facts, tools, photo limits, answer-quality gates, or pricing safeguards.
- The route id/reason is returned in the API response and recorded through normal Ask observability.
- The router stays small and falsifiable. It does not answer questions, retrieve knowledge, or override
  runtime safety rules.
- Do not add an AI intent-classification call ahead of the router (see `.ai/RULES.md`).

## Verify

`npm run test:icm` (routing cases, public/internal separation, contract completeness) and
`npm run test:ai-surfaces`.
