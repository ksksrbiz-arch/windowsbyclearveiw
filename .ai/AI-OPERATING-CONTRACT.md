# AI Operating Contract

**Status:** Active architecture policy  
**Updated:** 2026-09-09

This contract applies to new internal AI capabilities and extensions of `/ask`.

## 1. Deterministic first

Use application code for routing, validation, calculations, authorization, persistence, state transitions, and release gates whenever the rule can be expressed deterministically.

The existing ICM router is the default intent-routing mechanism. Do **not** insert an AI classifier ahead of it merely to classify user intent.

## 2. AI is bounded judgment

AI may summarize known facts, normalize unstructured input, identify likely paths, classify uncertainty, select relevant references, explain tradeoffs, and draft artifacts.

AI must not:

- invent measurements, quantities, product specifications, fastener schedules, pricing, credentials, or legal status;
- turn an observation into confirmed hidden site conditions or a diagnosis;
- override deterministic validation failures;
- approve, finalize, or otherwise complete a human business gate;
- mutate transactional business state without an explicit authorized application action.

## 3. Evidence protocol

Every material AI conclusion should remain distinguishable as:

- `KNOWN` — directly supported by application state, authoritative reference material, or explicit user input;
- `INFERRED` — a reasonable interpretation that must remain qualified;
- `VERIFY` — missing, conflicting, product-specific, site-specific, or safety-sensitive information.

`VERIFY` is a valid result, not an error condition.

## 4. Model/provider policy

Use the existing provider architecture unless a measured requirement justifies change:

- Groq is the primary `/ask` generation path.
- Gemini is the existing fallback/native function-calling path.
- Gemini `gemini-embedding-001` already powers the guide RAG index.
- Workers AI vision already powers bounded photo description through the `AI` binding.

New features should reuse these paths rather than introducing duplicate model infrastructure.

## 5. Fail down, never fail open

Provider failure, missing optional bindings, quota exhaustion, retrieval failure, or malformed AI output must degrade to a safe deterministic response or an explicit `VERIFY` state.

A failed model call must never cause the application to:

- assume missing facts;
- bypass a validation/gate;
- fabricate a result;
- persist unverified AI output as authoritative business state.

## 6. Budgets

Every new AI operation must define explicit limits before production use.

At minimum document:

- maximum input size;
- maximum history/context size;
- maximum output size;
- maximum tool rounds;
- maximum model calls per user operation;
- maximum vision calls per operation when applicable;
- timeout/failure behavior.

Existing `/ask` limits are the baseline. New internal features must not silently increase those limits.

Per-specialist budgets should be encoded in application configuration rather than relying only on prompt instructions.

## 7. Caching

Cache only outputs where the input and safety characteristics make reuse appropriate.

Good candidates include:

- deterministic guide retrieval results for identical normalized queries/context;
- repeated analysis of identical photo bytes using a content hash;
- deterministic Command Center aggregate snapshots.

Caches must have explicit invalidation/expiry rules and must never become the source of transactional truth.

Do not cache personalized/customer-sensitive results across users without an explicit isolation design.

## 8. Context minimization

AI receives the smallest bounded context required for the task.

Prefer:

- server-generated aggregates instead of unrestricted D1 exports;
- selected records instead of whole tables;
- relevant guide sections instead of the complete knowledge corpus;
- normalized fields instead of unnecessary raw PII.

Never expose secrets, credentials, session material, or internal configuration to a model.

## 9. Tool and mutation boundary

Models may request only explicitly allow-listed tools. Tool inputs and authorization are validated server-side.

No model receives arbitrary SQL access.

Read-only analysis is the default. Business mutations require an explicit application service and normal authorization; high-impact state transitions remain human actions.

## 10. Output validation

Structured AI output must be validated before the application uses it.

Validation must reject or downgrade:

- unsupported claims;
- missing required fields;
- invalid enums/statuses;
- invented numerical values where deterministic sources exist;
- attempts to complete approval/release gates;
- malformed tool/action requests.

## 11. Observability

Record enough metadata to diagnose behavior without creating a second business database or unnecessary PII exposure.

Useful metadata includes:

- route/specialist;
- provider path at coarse level;
- whether retrieval/tools/vision were used;
- success/degraded/failure state;
- validation outcome;
- proposed action type.

Avoid storing complete prompts or responses unless there is a documented operational need and appropriate data handling.

## 12. Human authority

AI confidence is not approval.

The application remains authoritative for quote finalization, Build Plan approval, Job creation, completion, payment state, and other transactional gates.

## 13. Architecture change rule

When a new AI feature is added, update:

1. this contract if a reusable rule is introduced;
2. `.ai/CONTEXT.md` if routing changes;
3. `.ai/STATE.md` with actual implementation status;
4. `HANDOFF.md` with operational implications;
5. regression tests for the new boundary.

Do not introduce undocumented architectural ratios or heuristics as policy.
