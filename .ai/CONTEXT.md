# Clearview ICM Router

This directory is the AI/control-plane context architecture for Clearview Windows.
It does not replace application code or D1.

## Walk order

1. Read root `CLAUDE.md` for global constraints.
2. Read `.ai/STATE.md` for current architecture and migration status.
3. Read `.ai/RULES.md` for cross-cutting reasoning boundaries.
4. Identify the user's/request's business object: lead, estimate, quote, build plan, job, customer, installation, QC, or public question.
5. Route to exactly one primary workflow or specialist before loading detailed references.
6. Load only the references required by that stage.
7. Produce an inspectable output and record unresolved `VERIFY` items.
8. Commit business state through deterministic application services only.

## Primary routing map

| Need | Route |
|---|---|
| Scope a quote into an executable field plan | `workflows/build-plan/` |
| Diagnose a window symptom/photo | `specialists/diagnostician/` |
| Calculate or explain project pricing | `specialists/estimator/` |
| Review installation logic | `specialists/installation-reviewer/` |
| Help a homeowner decide what to do next | `specialists/customer-advisor/` |

## Business lifecycle

`Lead → Estimate → Quote → Build Plan → Job → Installation → QC → Closeout`

The ICM representation mirrors this lifecycle but never becomes the database of record.

## Context layers

- **Layer 0:** `CLAUDE.md` — identity and global operating contract.
- **Layer 1:** this file — routing.
- **Layer 2:** stage `CONTEXT.md` — stage contract and boundaries.
- **Layer 3:** `references/` — stable domain knowledge and authorities.
- **Layer 4:** `output/`, records, and application state — current work.

## Handoff rule

Embed the necessary result into the next stage's input/output artifact. Do not make a later stage crawl unrelated directories to reconstruct prior reasoning.

## Deterministic boundary

The AI can propose scope, classify uncertainty, select references, explain tradeoffs, and draft artifacts. Code must perform calculations, validation, persistence, authorization, versioning, state transitions, and final safety/quality gates.
