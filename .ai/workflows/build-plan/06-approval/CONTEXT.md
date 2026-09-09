# Stage 06 — Approval

## Inputs

Completed scope, openings, materials, installation, QC, quality lint, and sources.

## Process

Review blockers and VERIFY items. Confirm that the plan matches the quote snapshot. Human reviewer explicitly approves, requests changes, or leaves the plan in draft.

Application state transitions are deterministic: `draft -> review -> approved`; a reviewed plan may return `review -> draft` for changes, and an approved plan may only move to `reopened -> review` when deliberately reopened. Approval is invalid while quality blockers remain.

An approved plan is locked at the persistence layer. Editing requires an explicit reopen transition. Quote finalization is also gated on an approved, current Build Plan; a quote changed after approval must be reconciled and re-approved before it can be finalized.

## Outputs

`approval.json` containing approval state, reviewer, timestamp, reviewed plan version, unresolved VERIFY items, and any notes.

## State boundary

Only an explicit application-level approval may make a Build Plan eligible to become the Job's operational snapshot or allow the associated quote to be finalized. AI output never constitutes approval. Job creation must reject any plan that is not `approved` or whose approval was made against a stale quote/version.

## Stop conditions

Any quality blocker remains, quote is stale, approval is absent, the reviewed plan version does not match the current quote source snapshot, or the approved plan has been edited without reopening.
