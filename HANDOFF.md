# Project context — Clearview Windows

This file is the durable handoff for future agents. Technical detail lives in `README.md`; architecture/state also lives in `.ai/`.

## ICM implementation status — 2026-09-08

Clearview is being built as a deterministic business system with an **ICM control plane** around it. The ICM layer is intentionally plain-text, inspectable, and editable. It is not a second database and does not replace D1, application validation, authorization, or state transitions.

### Architecture

```text
CLAUDE.md                 Layer 0: global operating contract
  ↓
.ai/CONTEXT.md            Layer 1: router
  ↓
workflow/specialist       Layer 2: stage/specialist contract
  ↓
references/authorities    Layer 3: stable knowledge
  ↓
records/artifacts         Layer 4: current work
  ↓
deterministic services   D1/API/code remain transactional truth
```

The operating rule is **navigate before reasoning**. A fresh agent should be able to orient itself from files alone, choose one workflow/specialist, read only the necessary context, act, and report the next state.

### ICM principles adopted here

1. One stage, one job.
2. Plain text is the human-editable interface.
3. Load context in layers rather than dumping the entire repository into a prompt.
4. Every stage produces an inspectable handoff/edit surface.
5. Configure the system/factory; do not bury policy inside one-off outputs.
6. Deterministic code performs repeatable work; AI performs bounded judgment.
7. Ambiguity affecting safety, price, ordering, installation, or commitments becomes `VERIFY`.
8. Human review is a real state boundary, not a suggestion hidden in prose.

## Build Plan — first canonical ICM pipeline

The production Build Plan is now represented as six explicit stages:

```text
01-scope
   ↓
02-openings
   ↓
03-materials
   ↓
04-installation
   ↓
05-qc
   ↓
06-approval
```

Each stage has its own `CONTEXT.md` describing **Inputs / Process / Outputs / Stop conditions**. The current deterministic implementation remains `functions/internal/api/build-plan.js`, with quality/evidence rules in `functions/_lib/build-plan-rules.mjs`.

The API currently provides:

- quote-derived source snapshots
- plan versioning
- stale-plan detection when quote items change
- fresh baseline regeneration
- manufacturer/authority metadata
- material classification
- installation sequence
- opening-by-opening records
- QC checks
- lint blockers/warnings
- draft-only editing
- read-only behavior after quote finalization
- Build Plan snapshotting into jobs

### Evidence vocabulary

Use these states consistently:

- **KNOWN** — directly supplied by the quote, site record, product documentation, or other authoritative source.
- **INFERRED** — reasonable classification derived from explicit evidence, but not sufficient for a commitment.
- **VERIFY** — requires Mark/site inspection/order confirmation/manufacturer documentation before proceeding.

Never turn a missing measurement into a dimension, a guessed product into a specification, or a generic installation practice into a product-specific instruction.

## Ask — deterministic ICM routing seam

`functions/ask/_lib/icm-router.mjs` now provides the first deterministic routing seam for the public `/ask` assistant.

It routes to exactly one specialist contract:

| Route | Use for |
| --- | --- |
| `diagnostician` | fog, drafts, condensation, damage, leaks, visible symptoms |
| `estimator` | estimates, quotes, price, cost, budget |
| `installation-reviewer` | installation, flashing, rough openings, fasteners, new construction |
| `customer-advisor` | comparisons, performance, appearance, planning, general next actions |

This router intentionally does **not** answer the visitor, retrieve sources, or replace runtime safety checks. It is a small, falsifiable routing function. The existing Ask tool loop, retrieval, vision constraints, and answer-quality gate remain authoritative until the router migration is complete.

Regression coverage lives in `scripts/test-icm-router.mjs` and is exposed as `npm run test:icm`.

## Specialist contracts

Current contracts:

- `.ai/specialists/diagnostician/`
- `.ai/specialists/estimator/`
- `.ai/specialists/installation-reviewer/`
- `.ai/specialists/customer-advisor/`

These contracts are intentionally not copies of runtime prompts. They define scope, boundaries, evidence expectations, and workflow. Runtime prompts should consume the smallest relevant contract/context rather than creating a second policy universe.

## Golden cases

`.ai/workflows/build-plan/EXAMPLES.md` is the initial reasoning fixture set. When a bug exposes a reusable boundary, add a paired good/bad example plus the expected stop condition. High-value cases include:

- fogged IGU vs room-side condensation
- draft/air leakage
- sill or frame deterioration
- unknown installation method
- sliding-door replacement
- full-frame vs insert
- new construction
- mixed-opening project
- quote changes after plan generation
- missing manufacturer instructions

The target is to make these executable regression fixtures, not permanent documentation-only examples.

## Current limitations — do not call these complete

1. Build Plan stage artifacts are described by ICM but the UI still stores the operational plan as one D1 JSON artifact.
2. Build Plan approval/reconciliation needs a stronger explicit state machine and audit trail.
3. Ask routing exists as a deterministic seam but is not yet fully integrated into the chat prompt/context assembly.
4. Specialist reference files need deeper authoritative source mapping as the knowledge library grows.
5. Golden cases need automated end-to-end evaluation against the real Ask and Build Plan services.
6. Lead → Estimate → Quote → Build Plan → Job → Installation → QC → Closeout has an architectural map but not every stage has an ICM implementation.

Do not claim any of these are complete until code, tests, and live behavior establish it.

## Working rules

- Verify rather than assert.
- Push changes to `main` for this project; Cloudflare Pages deploys automatically.
- Do not invent reviews, credentials, L&I numbers, pricing, warranties, measurements, or product specifications.
- Public website domain is `windowsbyclearview.com`; production mail currently remains on `windowsbyclearveiw.com` until a real canonical-domain mailbox is provisioned and tested.
- Keep D1 as transactional truth.
- Keep ICM context files free of secrets and customer PII.
- Update this handoff and `.ai/WORKING.md` when architecture changes.
