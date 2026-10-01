# ICM rules (reference)

Load this before creating or editing any `CONTEXT.md`, router, or reference file.
Moved from the root `CLAUDE.md` on 2026-10-01. The structure is enforced by `npm run test:icm-structure`.

## Layout (this repo keeps `.ai/`, by decision of 2026-10-01)

Keith's standard ICM layout names the folder `context/`. Clearview keeps `.ai/` because the router,
specialist loader, tests and docs reference it; renaming a working production system gains nothing.
Map: `.ai/references/` = `context/references/`; `.ai/workflows/<name>/CONTEXT.md` = `context/workflows/<name>/CONTEXT.md`.

## Rules

- Root orientation: `CLAUDE.md` → `.ai/CONTEXT.md` → relevant workflow/specialist → references/state.
- The root file is routing only (≤80 lines). Reference files are ≤200 lines each.
- Identity explains philosophy and scope; it does not masquerade as a human persona.
- Routers point; they do not duplicate large bodies of knowledge.
- Stable knowledge belongs in references. Per-run state belongs in records/artifacts.
- Stage and workflow contracts declare **Input / Process / Output / Completion**, plus **Stop conditions**
  (Stop conditions are Clearview's addition: when to halt and surface `VERIFY` instead of finishing).
- Prefer deterministic scripts and validators over prompts for repeatable transformations.
- Examples are executable documentation: keep good/bad/edge cases for safety- or quality-critical workflows.
- Adjacent-stage handoffs are explicit: stage N+1 consumes the documented output of stage N.

## Contract template

```markdown
# <Workflow or stage name>
## Input        what must exist before starting; where it comes from
## Process      numbered steps; which parts are deterministic code, which are AI judgment
## Output       the inspectable artifact; where it lands
## Stop conditions   when to halt and surface VERIFY
## Completion   how "done" is checked, by which command or human, and what must be updated
```

## Walk test

A fresh agent should be able to: orient, locate the correct stage, understand what to do, identify the
current state, and report what remains, without conversation memory. When you change architecture, run it.
