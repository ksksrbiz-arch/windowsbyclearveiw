# ICM Implementation Record

**Date:** 2026-09-08
**System:** Clearview Windows / Clear View Windows & Trim LLC
**Status:** Phase 1 foundation implemented

## 1. Why this exists

Clearview is becoming more than a static marketing site. It now contains public AI assistance, pricing services, quoting, Build Plans, jobs, payments, and field workflows. As AI capabilities grow, a single large prompt becomes a poor control surface: it hides routing, mixes stable rules with changing state, and makes it difficult for a fresh agent or human to understand why a decision was made.

ICM is introduced as the filesystem/context architecture that makes AI-assisted work inspectable and composable.

The important architectural separation is:

```text
                 ┌──────────────────────────────┐
                 │ ICM CONTEXT / CONTROL PLANE │
                 │ routes + contracts + refs   │
                 │ examples + working context  │
                 └──────────────┬───────────────┘
                                │
                       AI judgment / routing
                                │
                 ┌──────────────▼───────────────┐
                 │ DETERMINISTIC APP SERVICES  │
                 │ validation + calculations    │
                 │ authorization + persistence  │
                 │ state transitions + gates   │
                 └──────────────┬───────────────┘
                                │
                           transactional
                              business
                               state
                                │
                         ┌──────▼──────┐
                         │     D1      │
                         └─────────────┘
```

## 2. What ICM owns

ICM owns:

- orientation;
- routing;
- stage contracts;
- stable domain references;
- evidence boundaries;
- working-artifact structure;
- golden examples;
- human-readable handoffs;
- architecture state.

ICM does **not** own:

- customer records;
- quote totals;
- payment state;
- authentication;
- authorization;
- final pricing calculations;
- database transactions;
- production approval state.

Those remain application concerns.

## 3. Context loading model

### Layer 0 — identity

`CLAUDE.md`

Answers: **Where am I? What rules govern me?**

Keep this stable and short. It contains operating philosophy and non-negotiables, not project-specific working state.

### Layer 1 — router

`.ai/CONTEXT.md`

Answers: **Where should I work?**

The router should point to the smallest relevant workflow or specialist.

### Layer 2 — stage contract

`workflows/*/CONTEXT.md` or specialist `CONTEXT.md`

Answers: **What is this stage responsible for? What does it consume? What does it produce? When does it stop?**

### Layer 3 — references

Stable technical/business knowledge: manufacturer instructions, code/building-science authorities, approved business facts, pricing methodology, and other reviewed material.

### Layer 4 — working state

Current quote, plan, job, opening information, photos, tool results, and other run-specific artifacts. Transactional state remains in D1; temporary reasoning artifacts may be represented explicitly when useful.

## 4. Build Plan as the reference implementation

Build Plan was selected first because it already demonstrates the correct deterministic architecture.

### Pipeline

```text
01 Scope
   ↓
02 Openings
   ↓
03 Materials
   ↓
04 Installation
   ↓
05 QC
   ↓
06 Approval
   ↓
Job snapshot
```

### Stage responsibilities

**01 Scope** establishes what the quote actually promises.

**02 Openings** turns scope into stable opening records without fabricating dimensions or installation methods.

**03 Materials** separates quote-derived purchases from baseline, conditional, and unresolved materials.

**04 Installation** creates the field sequence around opening inspection, water management, setting, manufacturer-specific fastening, air sealing, finish, and verification.

**05 QC** turns the installation requirements into checks that must be performed rather than assumed.

**06 Approval** creates the human state boundary before the plan becomes operational job state.

## 5. Evidence states

All AI-assisted operational reasoning should distinguish:

### KNOWN
Supported directly by authoritative input.

Examples:

- quote line says quantity 6;
- manufacturer document specifies a fastener schedule;
- customer explicitly says “six windows”;
- application reports quote version 4.

### INFERRED
Reasonable interpretation, but not a fact.

Examples:

- a symptom is consistent with a failed IGU seal;
- a quote description likely refers to an insert replacement;
- an opening appears to be a slider in a photograph.

Inference must remain visibly qualified.

### VERIFY
Cannot responsibly be determined from current evidence.

Examples:

- rough-opening dimensions;
- concealed rot;
- exact fastener spacing without product instructions;
- site-specific flashing configuration;
- final purchase quantity of conditional consumables.

`VERIFY` is a successful safety behavior, not an error state.

## 6. Deterministic/AI split

The target architecture is approximately:

- **60% deterministic implementation:** SQL, APIs, schemas, validators, calculations, transformations.
- **30% rules and routing:** context selection, evidence classification, quality gates, stage boundaries.
- **10% AI judgment:** interpretation, drafting, explanation, prioritization.

These are design targets, not measured benchmarks.

The deeper rule is: **do not ask a model to perform work that a deterministic function can perform more reliably.**

## 7. Human approval model

Operational artifacts follow:

```text
draft → review → approved → job snapshot
```

AI can produce a draft and identify issues. It cannot manufacture approval.

A job should contain the exact approved plan version used for field operations. If the quote changes, the plan must become stale and require reconciliation.

## 8. Golden cases

`.ai/workflows/build-plan/EXAMPLES.md` contains reusable fixtures for:

- fogged IGU;
- drafty double-hung;
- sill rot;
- unknown installation method;
- mixed opening types;
- quote changes after plan generation.

Future failures should become paired examples where possible:

- **bad case:** the failure mode;
- **good case:** the desired behavior;
- **annotation:** the boundary that distinguishes them.

## 9. Specialist architecture

Current specialist contracts:

```text
.ai/specialists/
├── diagnostician/
├── estimator/
├── installation-reviewer/
└── customer-advisor/
```

These are intentionally narrow. A specialist is not a fictional employee persona. It is a bounded operating contract with a specific responsibility and evidence boundary.

Future specialist folders should use the same grammar and may add:

- `IDENTITY.md` — philosophy and scope;
- `RULES.md` — falsifiable constraints;
- `REFERENCE.md` — routing to stable references;
- `WORKFLOW.md` — procedural sequence;
- `EXAMPLES.md` — matched examples.

Do not create those files merely for symmetry. Add them when the specialist has enough complexity to benefit from the separation.

## 10. Ask migration strategy

The public `/ask` system already has deterministic tools, retrieval, photo analysis, model fallbacks, safety gates, and evaluation scripts. ICM should therefore **wrap and route that system**, not replace it wholesale.

Target routing:

```text
Ask
├── diagnostician
├── estimator
├── installation-reviewer
├── customer-advisor
├── comparison
├── planning
└── estimate handoff
```

The existing tool layer remains the enforcement mechanism for pricing, knowledge retrieval, photo analysis, and business facts.

The migration should be incremental:

1. map existing intent classes to specialists;
2. load specialist contracts before model reasoning;
3. move stable prompt rules into readable ICM files;
4. retain deterministic tools as authority;
5. add golden cases;
6. compare old/new outputs before removing duplicated prompt text;
7. delete duplication only after regression coverage exists.

## 11. Quote → Build Plan → Job

This is the critical operational path:

```text
Quote
  │
  ├─ source snapshot
  │
  ▼
Build Plan draft
  │
  ├─ quality lint
  ├─ manufacturer/authority sources
  ├─ VERIFY items
  └─ opening schedule
  │
  ▼
Human review
  │
  ▼
Approved plan
  │
  ▼
Job snapshot
```

The saved plan must not silently mutate because the quote changed. Staleness is a first-class condition.

## 12. What a future agent must not do

- Do not move business state from D1 into Markdown.
- Do not create a giant `CLEARVIEW_AGENT.md` containing every rule and every customer record.
- Do not make every stage read every other stage.
- Do not let a later stage reconstruct earlier reasoning from conversation memory.
- Do not hide safety-critical rules only inside a model prompt.
- Do not make an AI output equivalent to an approval action.
- Do not use ICM structure as an excuse to duplicate deterministic code.

## 13. Maintenance procedure

When a workflow changes:

1. Update the stage contract.
2. Update affected references.
3. Add/update a golden case if the change addresses a reasoning failure.
4. Update `.ai/STATE.md` when architecture/status changes.
5. Update `HANDOFF.md` with the why, current state, and remaining work.
6. Update `CLAUDE.md` only when the global operating contract changes.
7. Run the relevant deterministic tests/build.
8. Validate the live path when deployment behavior is affected.

## 14. Completion definition

ICM implementation is complete for a workflow when a fresh agent can:

1. orient from root files;
2. route to the correct workflow;
3. understand the stage contract;
4. identify the current state;
5. load the necessary references without loading the whole repository;
6. produce an inspectable artifact;
7. surface unresolved conditions;
8. hand the result to the next stage without hidden dependencies;
9. know exactly what remains before the business state can advance.

That is the standard to apply as ICM expands across Clearview.
