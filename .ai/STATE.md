# ICM State — 2026-09-09

## Status

**Phase 2 implementation in progress:** hardened ICM foundation + deterministic Build Plan lifecycle + quote/job approval gates + Ask specialist runtime + internal AI surfaces.

## What exists

- Root `CLAUDE.md` defines the agent operating contract.
- `.ai/CONTEXT.md` is the router.
- `.ai/RULES.md` defines evidence, uncertainty, safety, synchronization, and approval rules.
- `.ai/STATE.md` records architecture state rather than mixing state into identity.
- `.ai/workflows/build-plan/` defines the complete Build Plan pipeline, including human approval.
- `.ai/specialists/` defines specialist contracts used by Ask and internal AI routing.
- `functions/_lib/build-plan-rules.mjs` owns durable installation/material/QC rules and quality linting.
- `functions/_lib/build-plan-state.mjs` owns allowed Build Plan lifecycle transitions and source-snapshot invariant.
- `functions/internal/api/build-plan-state.js` persists state, recalculates live quality, detects quote drift, records approval, and locks approved plans until explicitly reopened.
- `src/pages/internal/quotes/build-plan-approval.astro` exposes the human approval gate with live quality/freshness checks.
- `functions/ask/_lib/icm-router.mjs` deterministically routes public and internal AI requests to one specialist.
- `functions/ask/_lib/icm-specialists.mjs` provides bounded runtime specialist contracts while `.ai/specialists/*/CONTEXT.md` remains canonical.
- `functions/ask/api/chat.js` injects the selected specialist contract before retrieval/model generation and returns route metadata.
- `/internal/copilot` provides an authenticated, read-only operational AI surface with bounded history and provider fallback.
- `/internal/leads/analyze` provides a human-invoked Lead Analyzer workflow.
- `functions/internal/api/lead-analyzer.js` reads bounded lead data from D1 and performs advisory analysis without mutation.
- `functions/internal/api/copilot-summary.js` converts a bounded Command Center snapshot into an advisory operational summary without mutation.

## Internal AI boundary

Internal AI follows deterministic routing first. AI may summarize, classify uncertainty, identify missing information, and recommend a next human action. It cannot approve gates, invent measurements/specifications/pricing/credentials/legal status, directly execute arbitrary SQL, or silently mutate business state.

Lead page-view behavior is contextual evidence only; it is not proof of customer intent. Lead Analyzer output is advisory and must be verified against the underlying record.

Command Center summarization uses a bounded server-generated snapshot rather than unrestricted D1 export. Numerical counts, totals, statuses, and transactional state remain application-owned facts.

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

## CI / verification

The GitHub build workflow contains the repository regression suite and production build. Connector-visible latest commits have not yet produced a usable workflow execution, so CI execution remains unverified. This is an external GitHub Actions startup/billing issue, not an application test result.

Direct production execution of `/ask`, `/internal/copilot`, Lead Analyzer, and the Cloudflare Workers AI binding remains a deployment verification task.

## Known architectural boundaries

Do not turn `.ai/` into a second database. Working artifacts can document decisions, but committed business state must remain in the application's transactional store.

Do not add an AI intent-classification hop ahead of the deterministic ICM router.

Do not treat generated confidence as human approval or evidence.

## Walk-test target

A fresh agent with no conversation memory should be able to read `CLAUDE.md`, `.ai/CONTEXT.md`, this file, and the relevant workflow contract and immediately determine where to work, what evidence is allowed, what output is required, and what remains incomplete.
