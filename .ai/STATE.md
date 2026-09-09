# ICM State — 2026-09-08

## Status

**Phase 1 implemented:** ICM foundation + Build Plan workflow contract.

## What exists

- Root `CLAUDE.md` defines the agent operating contract.
- `.ai/CONTEXT.md` is the router.
- `.ai/RULES.md` defines evidence, uncertainty, safety, synchronization, and approval rules.
- `.ai/STATE.md` records architecture state rather than mixing state into identity.
- `.ai/workflows/build-plan/` defines the first complete ICM pipeline.
- `.ai/specialists/` defines the first specialist contracts for future Ask/Command Center routing.
- Existing deterministic Build Plan implementation remains in `functions/internal/api/build-plan.js` and `functions/_lib/build-plan-rules.mjs`.

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

The ICM layer documents and structures the reasoning around this implementation. It does not duplicate these deterministic guarantees in Markdown.

## Planned expansion

1. Make Build Plan stage artifacts first-class inspectable records in the internal UI.
2. Add explicit plan regeneration/reconciliation UX when a quote becomes stale.
3. Route Ask intents through ICM specialist contracts while retaining current tool guardrails.
4. Add golden-case examples/evaluation corpus for Build Plan and Ask.
5. Extend the ICM pattern to customer communications, job preparation, installation review, QC, and closeout.
6. Add deterministic scripts where repeated transformations are currently prompt-driven.

## Known architectural boundary

Do not turn `.ai/` into a second database. Working artifacts can document decisions, but committed business state must remain in the application's transactional store.

## Walk-test target

A fresh agent with no conversation memory should be able to read `CLAUDE.md`, `.ai/CONTEXT.md`, this file, and the relevant workflow contract and immediately determine where to work, what evidence is allowed, what output is required, and what remains incomplete.
