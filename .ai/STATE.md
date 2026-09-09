# ICM State — 2026-09-08

## Status

**Phase 1 implemented:** ICM foundation + Build Plan workflow contract. **Phase 1.1 implemented:** deterministic Build Plan approval state machine and review surface.

## What exists

- Root `CLAUDE.md` defines the agent operating contract.
- `.ai/CONTEXT.md` is the router.
- `.ai/RULES.md` defines evidence, uncertainty, safety, synchronization, and approval rules.
- `.ai/STATE.md` records architecture state rather than mixing state into identity.
- `.ai/workflows/build-plan/` defines the first complete ICM pipeline.
- `.ai/specialists/` defines the first specialist contracts for future Ask/Command Center routing.
- Existing deterministic Build Plan implementation remains in `functions/internal/api/build-plan.js` and `functions/_lib/build-plan-rules.mjs`.
- `functions/_lib/build-plan-state.mjs` now defines the allowed draft/review/approved/reopened transitions.
- `functions/internal/api/build-plan-state.js` persists and exposes those transitions through D1.
- `src/pages/internal/quotes/build-plan-approval.astro` provides the human approval gate.
- `scripts/test-build-plan-state.mjs` covers the transition invariants.

## Existing deterministic Build Plan system

The application already:

- derives a plan from quote/items;
- versions and persists plans in D1;
- snapshots quote source data;
- detects stale plans when quote data changes;
- records authority/manufacturer source metadata;
- lints for missing openings, unsupported hard quantities, invented fastener specs, missing water management, missing drainage/operation checks, and quote/opening mismatches;
- blocks save on quality blockers;
- snapshots the plan when a job is created;
- displays the plan in the internal job view.

The new approval layer adds an explicit human state boundary. Approval is rejected when quality blockers remain; the review page also rejects approval when the quote is stale. Job eligibility is exposed through `assertJobEligible` and still needs to be enforced at the existing job-creation write path.

## Planned expansion

1. Enforce `assertJobEligible` inside the existing job-creation API before a job can be created.
2. Add explicit plan regeneration/reconciliation UX when a quote becomes stale.
3. Route Ask intents through ICM specialist contracts while retaining current tool guardrails.
4. Add golden-case examples/evaluation corpus for Build Plan and Ask.
5. Extend the ICM pattern to customer communications, job preparation, installation review, QC, and closeout.
6. Add deterministic scripts where repeated transformations are currently prompt-driven.

## Known architectural boundary

Do not turn `.ai/` into a second database. Working artifacts can document decisions, but committed business state must remain in the application's transactional store.

## Walk-test target

A fresh agent with no conversation memory should be able to read `CLAUDE.md`, `.ai/CONTEXT.md`, this file, and the relevant workflow contract and immediately determine where to work, what evidence is allowed, what output is required, and what remains incomplete.
