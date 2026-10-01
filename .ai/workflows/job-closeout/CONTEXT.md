# Workflow: Job closeout

Finish a job honestly: every opening verified, exceptions resolved, customer walkthrough and warranty/care
handoff done, balance status confirmed, then ask for a review once.

## Load / exclude

| Load | Do not load |
|---|---|
| `functions/internal/api/job-closeout.js`, `job-checklist.js`, `job-evidence.js` | lead-to-quote, copy references |
| `functions/internal/api/review-request.js` | `.ai/workflows/build-plan/` stages (the plan is already a job snapshot) |
| `.ai/specialists/evidence-reviewer/CONTEXT.md` (advisory only) | |

## Input

A job (from a finalized quote with an approved Build Plan snapshot, or a general non-window job) with a
checklist, opening evidence and photos recorded in the Command Center.

## Process

1. Each opening is marked `Complete` in the job checklist. Photos are taken on the phone first; backup to R2 is
   optional until the bucket is connected.
2. Open opening exceptions are resolved. The Photograph gate currently trusts phone-reported counts (known gap).
3. Every project-level closeout checklist item is checked.
4. Mark confirms customer walkthrough, warranty/care handoff and final balance status, and enters a sign-off name.
5. Mark finalizes. The service blocks finalizing unless readiness holds (every opening complete, no open
   exceptions, closeout items all checked) and blocks cancelled jobs. A finalized closeout is read-only.
6. After finalization, one review request per job goes out (email, or Mark's own SMS) and is recorded in
   `review_requests`. General (non-window) jobs skip the window checklist gate.

Evidence Reviewer may compare photos and notes to the requirements. It never marks anything `PASS`.

## Output

A finalized `job_closeouts` row and, once, a recorded review request.

## Stop conditions

Readiness fails; sign-off or confirmations are missing; the job is cancelled; the closeout is already finalized.
Warranty or care wording that is not already in the repo is a `VERIFY` for Mark; never write it.

## Completion

Done when the closeout is finalized and the review request is recorded or intentionally skipped. Code paths are
verified by `npm run test:review-request`, `test:quote-to-job`, `test:general-jobs` and `test:job-photos`.
A human (Mark) signs off; AI never does.
