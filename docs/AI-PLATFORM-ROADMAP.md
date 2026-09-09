# Clearview AI Platform Roadmap

**Status:** Phase 2 implementation started  
**Updated:** 2026-09-09  
**Scope:** Internal AI/control-plane capabilities and production verification

## 1. Purpose

This document is the implementation source of truth for the next AI platform phase. It deliberately distinguishes infrastructure that is already shipped from capabilities that still need to be built.

The architecture must extend the existing ICM/RAG/Ask foundation rather than recreate it.

## 2. Current baseline — already shipped

The following are existing capabilities and are **not greenfield work**:

- `/ask` already uses Groq as the primary model and Gemini as fallback.
- Gemini `gemini-embedding-001` already powers the committed guide RAG index.
- Workers AI vision analysis already exists in `functions/ask/_lib/vision.mjs` using the `AI` binding and `llama-3.2-11b-vision-instruct`.
- The vision path already follows the describe/observe-don't-diagnose boundary and does not turn photographs into measurements or authoritative scope.
- `functions/ask/_lib/icm-router.mjs` already performs deterministic regex-based specialist routing.
- `functions/ask/_lib/icm-specialists.mjs` already provides bounded runtime contracts for the existing Ask specialists.
- `.ai/CONTEXT.md`, `.ai/RULES.md`, and `.ai/STATE.md` already define the ICM control-plane architecture and evidence/approval rules.
- `/ask` already integrates routing, retrieval, business facts, tools, vision, safety gates, and provider fallback.
- The internal Command Center already exists at `/internal/`; the new work is AI augmentation, not a replacement dashboard.

## 3. Claims intentionally excluded

The earlier planning material contained a claimed `60% deterministic / 30% routing / 10% AI judgment` split. No authoritative source for that ratio was found in `.ai/RULES.md`, `.ai/CONTEXT.md`, or `.ai/STATE.md`. It is therefore **not an architecture rule** and must not be used for implementation or team documentation unless a real source is identified.

Likewise, the plan must not describe Gemini, RAG embeddings, Workers AI vision, or ICM routing as capabilities that still need to be wired in.

## 4. Architectural principles

### 4.1 Deterministic first

Use deterministic routing and application logic wherever the business decision can be expressed reliably in code. Do not add an AI intent-classification hop ahead of the existing ICM router merely to classify requests that regex/state rules can classify today.

### 4.2 AI proposes; code validates and commits

AI may summarize, normalize, classify uncertainty, propose next steps, select references, and draft artifacts. Code remains responsible for calculations, validation, authorization, persistence, versioning, state transitions, and release gates.

### 4.3 D1 remains transactional truth

`.ai/` is policy/context documentation, not a second database. Copilot and analyzers may read application state through bounded APIs/services and must not create shadow business state in markdown or model memory.

### 4.4 Evidence states remain explicit

Use the existing `KNOWN`, `INFERRED`, and `VERIFY` protocol. Generated confidence is never equivalent to human approval.

### 4.5 Existing Ask safety boundaries remain authoritative

New internal AI features inherit the same prohibitions already used by Ask: no invented measurements/specifications/quantities, no unsupported credentials or legal status, no final-price invention, no diagnosis from visual evidence, and no bypass of deterministic gates.

## 5. Target architecture

```text
                    ┌──────────────────────────────┐
                    │ Existing ICM / D1 application │
                    │ transactional business state │
                    └──────────────┬───────────────┘
                                   │
                    bounded context/service reads
                                   │
             ┌─────────────────────┴─────────────────────┐
             │                                           │
      Deterministic ICM Router                    Internal AI Surfaces
      existing + extended                         new `/internal/copilot`
             │                                           │
     exactly one specialist                    Lead Analyzer / summaries
             │                                           │
      specialist contract                       AI generation only where
             │                                   judgment adds value
             └─────────────────────┬─────────────────────┘
                                   │
                     existing RAG / tools / models
                                   │
                 Groq → Gemini fallback; Workers AI vision
                                   │
                       bounded, inspectable output
```

## 6. Workstreams and priority

### P0 — Production AI binding verification

**Goal:** determine whether Cloudflare Pages production actually has the `AI` Workers AI binding required by `/ask` photo analysis.

**Tasks:**
1. Verify the production Pages project/environment configuration.
2. Confirm binding name is exactly `AI`.
3. Exercise the live `/ask` photo path with a safe test image if operationally appropriate.
4. Confirm graceful degradation when AI is unavailable remains intact.
5. Update README and `.ai/STATE.md` from unchecked to verified only after evidence exists.

**Done when:** production configuration and a live behavior check agree.

### P1 — AI operating contract

Create a concise runtime policy for internal AI features covering:

- model/provider selection;
- deterministic-first routing;
- token/input/output budgets;
- maximum tool rounds;
- timeout behavior;
- provider fallback;
- caching opportunities;
- no-provider/degraded behavior;
- logging/observability boundaries;
- PII minimization;
- evidence-state requirements;
- human approval requirements.

Do not introduce arbitrary percentage allocations.

**Done when:** every new AI feature can point to the same operating contract and has explicit failure behavior.

### P2 — Extend deterministic ICM routing

Extend `icm-router.mjs` only for genuinely new business intents required by the internal tools.

Candidate internal routes:

- `lead-analyzer`
- `command-summary`
- `copilot`
- additional specialist domains required by the five new contracts

The router should remain dependency-free, deterministic, cheap, and regression-tested. Copilot must not call an AI classifier before routing.

**Done when:** ambiguous cases have deterministic fallback behavior and regression tests cover positive, negative, and collision cases.

### P3 — Five new specialist contracts

Add the five specialist contracts from the approved architecture plan. Each contract must contain:

- scope;
- allowed inputs;
- authoritative sources;
- output schema/shape;
- `KNOWN`/`INFERRED`/`VERIFY` behavior;
- prohibited claims/actions;
- handoff target;
- test cases.

Runtime summaries belong in `functions/ask/_lib/icm-specialists.mjs`; canonical detailed context belongs under `.ai/specialists/*/CONTEXT.md`.

The five contracts must be finalized from the supplied architecture review rather than invented from the earlier greenfield assumptions.

### P4 — Internal `/internal/copilot`

Build the first new user-facing internal AI surface.

**Purpose:** authenticated operational assistant for staff working with Clearview business context.

**Requirements:**
- live only under `/internal/*` and inherit internal auth/privacy headers;
- deterministic ICM routing before model generation;
- one primary specialist contract per turn;
- bounded access to relevant D1/application facts;
- existing RAG where guide/reference knowledge is needed;
- existing pricing/tool authority for numerical pricing;
- no direct arbitrary database mutation by the model;
- structured citations/evidence where practical;
- explicit `VERIFY` items;
- clear degraded/provider-error state;
- conversation history bounded and privacy-conscious;
- no secret/environment leakage;
- audit/observability that records route and outcome without unnecessary PII.

**Non-goals for v1:** autonomous business-state mutation, AI approval of gates, replacing Command Center workflows, or AI intent classification ahead of deterministic routing.

### P5 — Lead Analyzer pipeline

Build a deterministic-plus-AI pipeline that turns a lead into an inspectable analysis artifact.

Pipeline:

```text
Lead record
  → deterministic normalization
  → deterministic enrichment from known application facts
  → ICM route
  → specialist analysis
  → structured opportunity/risk/missing-info output
  → human review
```

The analyzer should surface useful facts such as lead completeness, likely project stage, missing information, service-area fit, and recommended next action without pretending that uncertain facts are confirmed.

It must not silently alter lead records. Any write must occur through an explicit application service and, where business-impacting, a human action.

### P6 — Command Center natural-language summarizer

Add an AI summary layer to the existing `/internal/` Command Center.

Inputs should be a bounded, server-generated operational snapshot—not unrestricted raw D1 export.

The summary should answer questions such as:

- What needs attention today?
- Which leads are incomplete or stale?
- Which quotes/jobs are blocked and why?
- What changed since the previous operational snapshot?

The summary must link claims back to the underlying deterministic data and label uncertainty. It must never change state.

Prefer deterministic precomputation of counts, totals, statuses, age buckets, and blockers; use AI only to turn those known facts into useful narrative.

### P7 — Production/live verification and hardening

After each new surface:

- run repository regression suites;
- build production bundle;
- test authenticated internal route behavior;
- test provider fallback;
- test empty/malformed/stale data;
- test unauthorized access;
- test prompt/input size limits;
- test no-mutation behavior;
- test `VERIFY` handling;
- test mobile layout for internal UI;
- perform production smoke tests after deployment.

## 7. Five-specialist implementation template

Each new specialist should follow this shape:

```text
.ai/specialists/<id>/CONTEXT.md
functions/ask/_lib/icm-specialists.mjs
functions/ask/_lib/icm-router.mjs
scripts/test-icm-router.mjs
```

Where a specialist needs data beyond Ask's current capabilities, add a small deterministic application service/tool rather than allowing the model to query D1 arbitrarily.

## 8. `/internal/copilot` request lifecycle

```text
POST /internal/api/copilot
        │
        ├─ authenticate internal session
        ├─ validate request + enforce body/message/history limits
        ├─ normalize input
        ├─ deterministic ICM route
        ├─ assemble bounded context
        ├─ retrieve only relevant reference material
        ├─ run allowed tools (bounded rounds)
        ├─ Groq primary / Gemini fallback as appropriate
        ├─ validate structured response + safety rules
        ├─ attach route/evidence/VERIFY metadata
        └─ return response; no implicit state mutation
```

## 9. Observability

Every internal AI request should make it possible to answer:

- which route was selected;
- whether retrieval/tools/vision were used;
- which provider path was used, at least at a coarse level;
- whether the response degraded or failed;
- what structured business action, if any, was proposed.

Do not log full prompts, secrets, or unnecessary customer PII.

## 10. Security model

Internal AI is not a new trust boundary that bypasses the existing one.

Required controls:

- existing internal session authentication;
- same-origin protections for state-changing endpoints;
- request-size limits;
- bounded history and tool rounds;
- server-side authorization on every data/action service;
- no model-controlled arbitrary SQL;
- no model-controlled approval/finalization;
- no direct access to secrets;
- generic provider errors;
- no-store responses where appropriate;
- explicit output validation.

## 11. Testing strategy

### Unit/regression

- router collisions and fallbacks;
- specialist contract selection;
- request validation;
- output schema validation;
- evidence-state enforcement;
- no-mutation invariant;
- provider fallback;
- tool-round limits.

### Integration

- internal auth → copilot API;
- router → specialist → RAG/tools;
- D1 snapshot → analyzer;
- Command Center snapshot → summarizer;
- degraded provider behavior.

### Browser

Verify at minimum:

- `/internal/`
- `/internal/copilot`
- representative existing internal workflow
- `/ask`
- `/estimate`

Test desktop and mobile widths, authentication boundaries, navigation, error states, and no-JS/refresh behavior where applicable.

## 12. Definition of done

A workstream is complete only when:

1. implementation exists;
2. deterministic boundaries are explicit;
3. tests cover the important failure modes;
4. internal docs reflect the actual architecture;
5. no unsupported business claims were introduced;
6. build passes locally;
7. production behavior is verified where the feature depends on Cloudflare bindings;
8. handoff/state documentation identifies what remains.

## 13. Deferred work

- Homeowner Project Visualizer remains a later product feature. It should consume mature AI/vision infrastructure rather than driving the architecture prematurely.
- Durable public endpoint rate limiting remains a separate production-hardening item.
- Full production browser verification of the latest `/ask` behavior remains required.
- The known GitHub Actions startup/billing failure is external infrastructure and is not part of this roadmap's implementation scope.

## 14. First implementation sequence

1. Verify `AI` production binding.
2. Add this roadmap to the repository.
3. Add AI operating contract.
4. Extend deterministic router for new internal intents only where required.
5. Add the five specialist context contracts and runtime summaries.
6. Build `/internal/copilot` vertical slice end-to-end.
7. Add Lead Analyzer.
8. Add Command Center summarization.
9. Run full regression + browser + production verification.
10. Update `.ai/STATE.md`, `HANDOFF.md`, and README with actual verified state.

**Current execution point: #3/#4.**
