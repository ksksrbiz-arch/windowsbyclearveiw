# Opening Field Mode

## Purpose

Promote the Build Plan Visualizer from a document-style navigator into a field execution surface while preserving the approved Build Plan as the controlled production artifact.

## Opening lifecycle

Each opening is worked independently:

1. Verify — confirm product, opening type, dimensions, installation method, and existing condition in the field.
2. Remove — document existing-unit removal and inspect the opening for concealed conditions.
3. Prep — establish the actual water-management path and prepare the opening.
4. Install — execute the selected product manufacturer's current instructions.
5. Flash / Seal — complete the required water-management, air-sealing, insulation, and finish work for the actual assembly.
6. Operate — verify fit, alignment, operation, and finish.
7. Photograph — capture before, installation-progress, and after evidence.
8. Complete — close the opening only after its field gates are satisfied, then advance to the next opening.

Product-specific fasteners, clearances, sealants, flashing sequences, and warranty requirements remain VERIFY items unless supported by the selected manufacturer's current instructions.

## Project-level gates

The existing project checklist remains the closeout authority. Opening completion does not bypass project-level completion requirements. Current project checklist defaults include schedule/site preparation, installation completion, operation/fit checks, before/during/after photos, punch-list resolution, customer walkthrough, warranty/care handoff, and final balance/payment status.

## Implemented field-mode behavior

The job workspace exposes **Field mode** whenever an attached Build Plan snapshot exists. Field mode reads the immutable job snapshot and persists opening gates through the existing D1 checklist API.

The UI prevents advancing to a later opening until the current opening's `Complete` gate is checked. Forward jumps in the opening strip are also blocked until the current opening is complete; backward navigation remains available.

A missing job snapshot is a STOP condition. Field mode does not execute from the live quote/build-plan editor.

## Legacy snapshot reconciliation

A job with no `build_plan_json` is a legacy or incomplete production handoff. It is surfaced as a STOP condition rather than reconstructing a live plan silently.

Reconciliation is an explicit user action from the job workspace. The server verifies:

- the job has a quote;
- the quote is finalized;
- a saved Build Plan exists and is explicitly approved;
- the approved plan is still current relative to the quote source snapshot;
- the plan passes the same job-eligibility quality gates used by new job creation;
- the attachment is auditable, including the source Build Plan version and attachment timestamp/user.

Cancelled/history jobs are intentionally not auto-backfilled and the API refuses reconciliation for cancelled jobs.
