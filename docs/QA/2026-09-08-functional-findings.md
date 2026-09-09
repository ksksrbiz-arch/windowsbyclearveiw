# Functional QA Findings — 2026-09-08

## Confirmed

- Invoice detail view (`/internal/invoices/view`) was exercised against a real invoice. Fields and the $1,750 total matched the source quote; no console errors were observed.
- Build Plan Visualizer was exercised through the opening navigator and PREP/SET verification checklist for a real opening; rendering and interaction were correct with no errors.
- Job workspace navigation (View → Prep & closeout → back) works after interaction; no console errors were observed.

## Finding: first-click navigation

Two fresh-load cases have now reproduced the same minor behavior:

- `Open invoice` on `/internal/invoices`
- `Prep & closeout` on `/internal/jobs/view`

The first click can focus the link without navigating; the second click navigates.

The checked-in implementation uses native anchors for both paths. `InternalLayout.astro` does not install Astro `ClientRouter`, and neither link has a click handler that calls `preventDefault()`.

GitHub issue #77 tracks the defect. Do not add a generic navigation shim until browser-level reproduction identifies the cause; preserve normal modifier-click/new-tab behavior.

## Finding: legacy job without snapshot

Job `J-20260906-OF28` is a cancelled pre-existing job tied to quote `Q-20260906-AB57`. Its workspace can report that no saved Build Plan snapshot exists even when the quote's Build Plan editor has an approved populated plan.

The current job-creation API explicitly requires an approved, current Build Plan and copies its JSON, version, and knowledge version into the new job record. Therefore the observed legacy state is consistent with a job created before the current snapshot boundary, rather than evidence that the current create-job path silently drops the snapshot.

The current API should remain strict: finalized quote + explicitly approved Build Plan + unchanged source + quality gates before job creation. A legacy repair/reconciliation action should be deliberate and auditable rather than silently mutating historical jobs.
