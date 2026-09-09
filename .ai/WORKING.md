# Clearview ICM — Working Context

This file is Layer 4: current implementation work. It is intentionally separate from stable rules and identity.

## Current migration

**Phase:** ICM control plane → deterministic routing → Build Plan stage execution → Ask specialist routing → lifecycle coverage.

### Completed

- Root operating contract in `CLAUDE.md`.
- ICM router/context model in `.ai/CONTEXT.md`.
- Stable operating rules in `.ai/RULES.md`.
- Build Plan stage contracts in `.ai/workflows/build-plan/01-scope` through `06-approval`.
- Specialist contracts for diagnostician, estimator, installation reviewer, and customer advisor.
- Build Plan API remains the deterministic source of persistence, versioning, stale detection, and linting.

### Active implementation boundary

The ICM files do not replace D1 records. They describe how an AI agent should navigate and reason around the existing deterministic system.

The next code changes should make routing and stage transitions explicit without allowing an LLM to bypass application enforcement.

## Change protocol

1. Read the relevant Layer 0–2 contracts before changing code.
2. Identify the deterministic service that owns the state transition.
3. Add or update the smallest ICM context surface that explains the decision boundary.
4. Add a regression fixture when a new reasoning boundary is introduced.
5. Run build/tests and inspect the affected live workflow before declaring completion.
6. Update `HANDOFF.md` and this file when architecture changes.

## Do not place here

- Secrets.
- Customer PII.
- Mutable transactional records that belong in D1.
- Product-specific installation facts that have not been verified from authoritative documentation.
- Prompts copied verbatim from runtime code merely to make the filesystem look complete.
