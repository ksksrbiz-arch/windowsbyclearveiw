# Clearview AI Platform Roadmap

**Status:** Phase 2 implementation in progress  
**Updated:** 2026-09-09  
**Scope:** Internal AI/control-plane capabilities and production verification

## Current implementation status

The deterministic foundation and the first three internal AI vertical slices are now implemented on `main`:

- **P2:** deterministic ICM router extended with five internal-only specialist routes; public `/ask` cannot select them.
- **P3:** five runtime specialist contracts implemented in `functions/ask/_lib/icm-specialists.mjs`.
- **P4:** authenticated `/internal/copilot` page and read-only API implemented with bounded history, same-origin protection, deterministic routing, specialist contracts, controlled facts, and Groq → Gemini fallback.
- **P5:** `/internal/leads/analyze` and its bounded read-only Lead Analyzer API implemented.
- **P6:** bounded Command Center natural-language summary API implemented; UI integration remains outstanding.
- Regression scripts exist for ICM, Copilot, and AI surfaces, and the CI workflow now invokes the new AI regression checks.

**Not yet verified:** local execution/build in the current tool environment, live production `/ask`/Copilot/Lead Analyzer behavior, Cloudflare production `AI` binding, browser/mobile verification, and the complete Command Center summary UI integration.

## 1. Purpose

This document is the implementation source of truth for the next AI platform phase. It deliberately distinguishes infrastructure that is already shipped from capabilities that still need to be built.

The architecture must extend the existing ICM/RAG/Ask foundation rather than recreate it.

## 2. Current baseline — already shipped

The following are existing capabilities and are **not greenfield work**:

- `/ask` already uses Groq as the primary model and Gemini as fallback.
- Gemini `gemini-embedding-001` already powers the committed guide RAG index.
- Workers AI vision analysis already exists in `functions/ask/_lib/vision.mjs` using the `AI` binding and `llama-3.2-11b-vision-instruct`.
- The vision path already follows the describe/observe-don't-diagnose boundary and does not turn photographs into measurements or authoritative scope.
- `functions/ask/_lib/icm-router.mjs` performs deterministic specialist routing and now isolates internal-only routes from public `/ask`.
- `functions/ask/_lib/icm-specialists.mjs` provides bounded runtime contracts for all nine current specialists.
- `.ai/CONTEXT.md`, `.ai/RULES.md`, and `.ai/STATE.md` define the ICM control-plane architecture and evidence/approval rules.
- `/ask` integrates routing, retrieval, business facts, tools, vision, safety gates, and provider fallback.
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
      existing + extended                         `/internal/copilot`
             │                                     Lead Analyzer / summary API
     exactly one specialist                              │
             │                                   AI generation only where
      specialist contract                       judgment adds value
             │                                           │
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

**Status: outstanding.** Verify the Cloudflare Pages production `AI` binding and safely exercise the `/ask` photo path. Do not mark this complete without live evidence.

### P1 — AI operating contract

**Status: implemented.** `.ai/AI-OPERATING-CONTRACT.md` is the shared runtime policy for provider selection, budgets, fallback, privacy, evidence, and human authority.

### P2 — Extend deterministic ICM routing

**Status: implemented.** Internal-only routes are selected only when `surface === 'internal'`; regression coverage includes public/internal isolation and collision cases.

### P3 — Five new specialist contracts

**Status: implemented at runtime level.** The five contracts are present in `icm-specialists.mjs`. Detailed per-specialist `.ai/specialists/*/CONTEXT.md` files and a larger contract test matrix remain optional follow-up hardening, not prerequisites for the current vertical slices.

### P4 — Internal `/internal/copilot`

**Status: implemented vertical slice; hardening/verification outstanding.** The authenticated UI and read-only API exist. Remaining work includes structured output validation, observability, relevant RAG/reference retrieval where required, browser verification, and production smoke testing.

### P5 — Lead Analyzer pipeline

**Status: implemented vertical slice; hardening/verification outstanding.** The analyzer reads at most 25 bounded lead records, uses deterministic routing and a specialist prompt, and cannot mutate records. Remaining work includes structured output validation and integration/browser verification.

### P6 — Command Center natural-language summarizer

**Status: implemented API; UI integration outstanding.** The API reads a bounded server-generated D1 snapshot and is read-only. The next implementation pass should add a clearly labeled AI operational brief to the existing Command Center without replacing deterministic metrics.

### P7 — Production/live verification and hardening

**Status: outstanding.** Run repository regression suites, build, authenticated browser checks, provider fallback tests, malformed/empty/stale data tests, unauthorized checks, request-size tests, no-mutation tests, and Cloudflare production smoke tests.

## 7. Security model and required hardening

Internal AI remains behind the existing `/internal/*` session middleware. New endpoints use same-origin checks, request-size bounds, bounded inputs, generic provider errors, no-store responses, and read-only model behavior. The remaining hardening work is explicit output validation, minimal observability, and live verification.

## 8. Definition of done

A workstream is complete only when implementation, deterministic boundaries, regression coverage, documentation, safety constraints, local build/test evidence, and required production verification all agree. A source-level implementation is not labeled production-verified merely because the code exists.

## 9. Deferred work

- Homeowner Project Visualizer remains a later product feature.
- Durable public endpoint rate limiting remains a separate production-hardening item.
- Full production browser verification of the latest `/ask` behavior remains required.
- The known GitHub Actions startup/billing failure is external infrastructure and is not part of this roadmap's implementation scope.

## 10. Next implementation passes

1. Add structured output validation for internal advisory responses.
2. Add minimal privacy-safe AI observability.
3. Integrate the Command Center operational brief UI.
4. Expand Lead Analyzer/Evidence Reviewer regression coverage.
5. Run local build/regression checks where an executable repo environment is available.
6. Perform authenticated browser and production verification.
7. Update `.ai/STATE.md`, `HANDOFF.md`, and README only from observed evidence.
