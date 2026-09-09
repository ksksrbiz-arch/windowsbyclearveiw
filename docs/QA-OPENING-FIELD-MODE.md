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

The existing project checklist remains the closeout authority. Opening completion must not bypass project-level completion requirements. Current checklist defaults include schedule/site preparation, installation completion, operation/fit checks, before/during/after photos, punch-list resolution, customer walkthrough, warranty/care handoff, and final balance/payment status.

## Legacy snapshot reconciliation

A job with no `build_plan_json` is a legacy or incomplete production handoff. It must be surfaced as a STOP condition rather than reconstructing a live plan silently.

Reconciliation should be an explicit user action. The server must verify:

- the job has a quote;
- the quote is finalized;
- a saved Build Plan exists and is explicitly approved;
- the approved plan is still current relative to the quote source snapshot;
- the plan passes the same job-eligibility quality gates used by new job creation;
- the action is auditable, including the source Build Plan version and time of attachment.

Cancelled/history jobs should not be automatically backfilled.
