# Stage 06 — Approval

## Inputs

Completed scope, openings, materials, installation, QC, quality lint, and sources.

## Process

Review blockers and VERIFY items. Confirm that the plan matches the quote snapshot. Human reviewer explicitly approves, requests changes, or leaves the plan in draft.

Application state transitions are deterministic: `draft -> review -> approved`; a reviewed plan may return `review -> draft` for changes, and an approved plan may only move to `reopened -> review` when deliberately reopened. Approval is invalid while quality blockers remain.

## Outputs

`approval.json` containing approval state, reviewer, timestamp, reviewed plan version, unresolved VERIFY items, and any notes.

## State boundary

Only an explicit application-level approval may make a Build Plan eligible to become the Job's operational snapshot. AI output never constitutes approval. Job creation must reject any plan that is not `approved` or whose approval was made against a stale quote/version.

## Stop conditions

Any quality blocker remains, quote is stale, approval is absent, or the reviewed plan version does not match the current quote source snapshot.
