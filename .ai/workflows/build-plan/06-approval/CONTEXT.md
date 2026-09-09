# Stage 06 — Approval

## Inputs

Completed scope, openings, materials, installation, QC, quality lint, and sources.

## Process

Review blockers and VERIFY items. Confirm that the plan matches the quote snapshot. Human reviewer explicitly approves, requests changes, or leaves the plan in draft.

## Outputs

`approval.json` containing approval state, reviewer, timestamp, reviewed plan version, unresolved VERIFY items, and any notes.

## State boundary

Only an explicit application-level approval may make a Build Plan eligible to become the Job's operational snapshot. AI output never constitutes approval.

## Stop conditions

Any quality blocker remains, quote is stale, or approval is absent.
