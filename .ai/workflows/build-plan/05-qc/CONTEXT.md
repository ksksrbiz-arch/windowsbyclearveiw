# Stage 05 — Quality Control

## Inputs

Installation plan, opening schedule, quote scope, and applicable manufacturer/authority requirements.

## Process

Create a closeout checklist covering ordered product, opening condition, support/alignment, fastening per instructions, flashing/water management, sealant/air sealing, insulation, drainage/weeps, operation, locks/hardware, finish, cleanup, and required photos/documentation.

## Outputs

`qc.json` with project-level and opening-level checks. Each check is `PASS`, `FAIL`, or `VERIFY` until performed in the field.

## Stop conditions

Never pre-mark a field inspection item as passed from generated text. A plan is not evidence that installation occurred correctly.

## Completion

Done when `qc.json` has project-level and opening-level checks, every check is `PASS` / `FAIL` / `VERIFY`, and none is pre-marked `PASS`. Checked by: `npm run eval:build-plan`.
