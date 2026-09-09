# ICM State — 2026-09-08

## Status

**Phase 1 hardened:** ICM foundation + deterministic Build Plan lifecycle + quote/job approval gates + Ask specialist runtime seam.

## What exists

- Root `CLAUDE.md` defines the agent operating contract.
- `.ai/CONTEXT.md` is the router.
- `.ai/RULES.md` defines evidence, uncertainty, safety, synchronization, and approval rules.
- `.ai/STATE.md` records architecture state rather than mixing state into identity.
- `.ai/workflows/build-plan/` defines the complete Build Plan pipeline, including human approval.
- `.ai/specialists/` defines the specialist contracts used by Ask routing.
- `functions/_lib/build-plan-rules.mjs` owns durable installation/material/QC rules and quality linting.
- `functions/_lib/build-plan-state.mjs` owns the allowed Build Plan lifecycle transitions and source-snapshot invariant.
- `functions/internal/api/build-plan-state.js` persists state, recalculates live quality, detects quote drift, records approval, and locks approved plans until explicitly reopened.
- `src/pages/internal/quotes/build-plan-approval.astro` exposes the human approval gate with live quality/freshness checks.
- `functions/ask/_lib/icm-router.mjs` deterministically routes Ask requests to one specialist.
- `functions/ask/_lib/icm-specialists.mjs` provides bounded runtime specialist contracts while `.ai/specialists/*/CONTEXT.md` remains canonical.
- `functions/ask/api/chat.js` injects the selected specialist contract before retrieval/model generation and returns route metadata.

## Deterministic Build Plan system

The application now:

- derives a plan from quote/items;
- versions and persists plans in D1;
- snapshots quote source data;
- detects stale plans when quote data changes;
- records authority/manufacturer source metadata;
- lints for missing openings, unsupported hard quantities, invented fastener specs, missing water management, missing drainage/operation checks, and quote/opening mismatches;
- recalculates quality against the current quote at state-check time;
- blocks approval on live quality blockers or stale quote data;
- records reviewer/state history;
- requires an explicit source snapshot for approval/job eligibility;
- locks an approved plan at the database layer until explicitly reopened;
- requires an approved current Build Plan before a quote can be finalized;
- requires an approved current Build Plan before a finalized quote can become a Job;
- rejects Job creation when the approved plan has changed after approval;
- snapshots the approved Build Plan into the Job;
- displays the plan in the internal Job view.

## CI coverage

The GitHub build workflow runs:

1. ICM router regression tests;
2. Build Plan state-machine regression tests;
3. Build Plan integration wiring tests;
4. Build Plan golden-rule evaluation;
5. the Astro production build.

GitHub currently reports no workflow execution for the latest connector-visible commits, so CI execution still needs to be confirmed from GitHub/Cloudflare after connected deployment.

## Ask / ICM boundary

Ask specialist routing is now runtime-integrated. The deterministic router runs before retrieval/model generation, exactly one bounded specialist contract is injected into the model system context, and existing RAG, business facts, tools, photo analysis, pricing safeguards, and answer-quality gates remain authoritative. Runtime integration has regression coverage for the router/contracts; direct production endpoint execution still needs deployment verification.

## Known architectural boundary

Do not turn `.ai/` into a second database. Working artifacts can document decisions, but committed business state must remain in the application's transactional store.

## Walk-test target

A fresh agent with no conversation memory should be able to read `CLAUDE.md`, `.ai/CONTEXT.md`, this file, and the relevant workflow contract and immediately determine where to work, what evidence is allowed, what output is required, and what remains incomplete.
