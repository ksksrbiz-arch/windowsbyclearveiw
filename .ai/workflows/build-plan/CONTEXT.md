# Build Plan Pipeline

## Purpose

Turn an approved quote's known scope into a field-executable installation plan without pretending that missing site/product information is known.

## Pipeline

`01-scope → 02-openings → 03-materials → 04-installation → 05-qc → 06-approval`

Each stage has one job and emits an inspectable handoff for the next stage.

## Inputs

- Quote and quote items from D1.
- Quote source snapshot.
- Customer/project metadata available to the application.
- Exact product information when supplied.
- Applicable manufacturer installation instructions and authoritative building-science/code references.

## Process

1. Establish what the quote actually promises.
2. Enumerate openings; do not infer opening count from prose when quote quantities disagree.
3. Separate quote-derived purchases from baseline/conditional materials.
4. Build the installation sequence around inspection and water management.
5. Define opening-level and project-level QC.
6. Surface all `VERIFY` items and quality blockers.
7. Require explicit human approval before a plan becomes a job snapshot.

## Outputs

The final plan contains, at minimum:

- scope/source snapshot;
- opening schedule;
- BUY / LOAD / INSTALL / VERIFY information;
- material categories with evidence state;
- installation sequence;
- QC checklist;
- authorities/manufacturer sources;
- quality lint results;
- version/knowledge metadata;
- approval state.

## Stop conditions

Stop and surface `VERIFY` rather than guessing when:

- dimensions are absent or uncertain;
- exact product/series affects installation;
- opening type or installation method is unknown;
- concealed damage is possible;
- fastener type/spacing is product-specific;
- purchase quantity cannot be derived from the quote;
- water-management conditions are unresolved;
- quote scope conflicts with opening schedule.

## Deterministic implementation

`functions/internal/api/build-plan.js` is the application service. `functions/_lib/build-plan-rules.mjs` contains deterministic rules. This ICM workflow is the context contract around those services.
