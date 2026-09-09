# Clearview ICM Architecture

ICM (Interpretable Context Methodology) is used here as the repository's AI/control-plane architecture: filesystem structure provides routing, stage contracts define work, references hold stable knowledge, and working artifacts expose state. The application remains responsible for deterministic enforcement and transactional persistence.

## Design principles

1. One stage, one job.
2. Plain text is an inspectable interface.
3. Context loads progressively rather than dumping the whole repository into a prompt.
4. Every stage produces an edit surface.
5. Configure the workflow/factory; do not bury process in one giant prompt.
6. Deterministic code handles repeatable work; AI handles judgment.
7. Human approval separates proposal from commitment.

## Directory grammar

```text
.ai/
  CONTEXT.md                 # Layer 1 router
  RULES.md                   # cross-cutting constraints
  STATE.md                   # current implementation state
  README.md                  # architecture guide
  workflows/
    build-plan/
      CONTEXT.md             # pipeline contract
      EXAMPLES.md            # golden cases
      01-scope/
      02-openings/
      03-materials/
      04-installation/
      05-qc/
      06-approval/
  specialists/
    diagnostician/
    estimator/
    installation-reviewer/
    customer-advisor/
```

## Why Build Plan comes first

Build Plan is the cleanest proof of the architecture because it already has a deterministic service, versioned D1 state, source provenance, quality linting, quote-staleness detection, and a human operational handoff into Jobs. ICM therefore structures the reasoning without creating a competing source of truth.

## 60/30/10 target

Use approximately:

- **60% deterministic:** SQL, APIs, validators, calculations, transformations.
- **30% rules/routing:** context selection, stage contracts, evidence boundaries, quality gates.
- **10% AI judgment:** interpretation, classification, drafting, explanation, prioritization.

These are architectural targets, not a measured performance claim.

## Handoff discipline

Stage N should leave enough information for stage N+1 to proceed without reconstructing the prior stage from unrelated files. Cross-stage context should be embedded into the handoff artifact. Global rules remain globally readable.

## State discipline

Do not put changing customer/project state into `IDENTITY.md`, root instructions, or stable reference files. Store business state in D1 and temporary reasoning/work products in explicit output artifacts.

## Future expansion

The same grammar will cover Ask routing, customer communications, job preparation, installation review, QC, closeout, marketing operations, and knowledge maintenance. Each expansion should begin with a narrow stage contract and golden cases rather than a monolithic “Clearview agent” prompt.
