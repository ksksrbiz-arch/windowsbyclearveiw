# Production Hardening Plan

The Command Center is now in hardening rather than feature discovery. The operational lifecycle is:

`Lead → Estimate → Quote → Build Plan → Job → Field → QC → Closeout`

## Release gates

### P0 — must pass before production use

- [x] Approved Build Plan is snapshotted onto the job.
- [x] Legacy snapshot reconciliation is explicit and audited.
- [x] Opening execution gates are enforced server-side.
- [x] Photograph gate requires before/during/after evidence or a documented exception.
- [x] Open exceptions block opening completion.
- [x] Dedicated closeout release gate exists.
- [x] Finalized closeout records are read-only.
- [x] Internal routes require the signed session cookie.
- [x] Internal responses are marked noindex/no-store.
- [ ] Field drafts survive temporary network loss without losing user input.
- [ ] Original field photos are stored durably outside the device browser.
- [ ] Browser/mobile smoke test passes on current iOS Safari and desktop Chrome.
- [ ] First-click navigation defect in issue #77 is reproduced and closed.
- [ ] Production deployment reports a successful build.

### P1 — strongly recommended

- [ ] Replace hard-coded `mark` audit actor with the authenticated operator identity.
- [ ] Add explicit closeout event/audit history rather than only the current closeout row.
- [ ] Add a durable punch-list entity with owner, due date, status, and resolution evidence.
- [ ] Add server-side photo manifest reconciliation against durable photo storage.
- [ ] Add automated API contract tests for opening sequencing and closeout transitions.
- [ ] Add offline/online status and a visible sync queue in Field Mode.
- [ ] Add destructive-action confirmation for photo deletion and exception state changes.

## Mobile acceptance criteria

A crew member should be able to use Field Mode one-handed without horizontal scrolling. Primary actions must remain reachable with the phone's safe-area inset. A temporary network failure must never silently discard entered measurements, notes, material usage, or exception details.

The field workflow must remain understandable without training from the UI alone:

1. Select opening.
2. Verify the actual opening.
3. Record measurements/condition.
4. Execute gates in order.
5. Capture evidence.
6. Resolve or explicitly document exceptions.
7. Close the opening.
8. Repeat.
9. Reconcile project closeout.
10. Finalize only when all release gates pass.

## Current known limitation

The repository's GitHub Actions Build workflow is configured to run the regression suite and Astro build, but the latest production push failed before producing step-level results. Cloudflare also reported a failed build check. Until a successful deployment/build signal is observed, production readiness remains unverified even where application-level contracts are present.
