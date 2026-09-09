# Clearview Windows — Claude Operating Contract

This file is the root operating contract for AI agents working in this repository.
It is intentionally short enough to load first. Detailed architecture and state live in `.ai/` and `HANDOFF.md`.

## Mission

Build and maintain a trustworthy operating system for Clear View Windows & Trim LLC, not merely a marketing site. The public site, Command Center, deterministic services, and AI workflows must remain coherent.

## Non-negotiables

1. **Verify before asserting.** Read the current repo, run the relevant build/test, and inspect live behavior when deployment behavior matters.
2. **Never invent business facts.** No fake reviews, credentials, L&I number, pricing, warranties, product specifications, measurements, or customer facts.
3. **Deterministic code owns deterministic work.** Validation, calculations, persistence, authorization, state transitions, and schema enforcement belong in code. AI may judge, route, summarize, or propose.
4. **Human approval is a state boundary.** AI-generated plans are proposals until explicitly reviewed/approved. Never silently convert uncertain information into a commitment.
5. **D1 remains transactional truth.** ICM files are context, policy, workflow contracts, references, and working artifacts—not a replacement for business records.
6. **ICM is an architecture, not a chatbot feature.** Navigate context before reasoning; use the smallest sufficient context; make every stage output an inspectable edit surface.
7. **Stop on ambiguity that affects safety, price, ordering, installation, or customer commitments.** Surface `VERIFY` rather than guessing.
8. **Keep adjacent-stage handoffs explicit.** Stage N+1 consumes the documented output of stage N. Do not create hidden cross-stage dependencies.
9. **Phone-first internal UX matters.** Field workflows must work comfortably on a phone and preserve the Today → Leads → Quotes/Invoices → Jobs → Payments operating flow.
10. **Protect production spelling/domain/mail distinctions.** Public web domain is `windowsbyclearview.com`; production mail currently uses the legacy typo domain `windowsbyclearveiw.com` until a real mailbox exists on the canonical domain.

## ICM rules

- Root orientation: `CLAUDE.md` → `.ai/CONTEXT.md` → relevant workflow/specialist → references/state.
- Identity explains philosophy and scope; it does not masquerade as a human persona.
- Routers point; they do not duplicate large bodies of knowledge.
- Stable knowledge belongs in references. Per-run state belongs in records/artifacts.
- Stage contracts must declare **Inputs / Process / Outputs / Stop conditions**.
- Prefer deterministic scripts and validators over prompts for repeatable transformations.
- Examples are executable documentation: maintain good/bad/edge cases when a workflow is safety- or quality-critical.
- A fresh agent should be able to pass the ICM walk test: orient, locate the correct stage, understand what to do, identify the current state, and report what remains without relying on conversation memory.

## Ask routing

`functions/ask/_lib/icm-router.mjs` is the deterministic Layer-1 routing seam for `/ask`. It runs before retrieval/model generation and selects exactly one specialist contract from the public Ask context.

- `diagnostician` — symptoms, visible damage, moisture, drafts
- `estimator` — price, budget, estimate/quote requests
- `installation-reviewer` — installation, flashing, opening preparation, new construction
- `customer-advisor` — comparisons, performance, appearance, planning

`functions/ask/_lib/icm-specialists.mjs` supplies the small runtime contract selected by the router. The `.ai/specialists/*/CONTEXT.md` files remain the canonical human-agent context; the runtime module intentionally contains only bounded execution summaries, not a second technical knowledge base.

The selected specialist contract is injected into the same system context used by Groq/Gemini. It does not bypass RAG, business facts, tools, photo limits, answer-quality gates, or pricing safeguards. The route id/reason is returned in the API response and recorded through normal Ask observability.

The router must remain small and falsifiable. It does not answer questions, retrieve knowledge, or override runtime safety rules.

## Current ICM implementation

The first production ICM workflow is Build Plan generation:

`.ai/workflows/build-plan/01-scope → 02-openings → 03-materials → 04-installation → 05-qc → 06-approval`

The existing deterministic Build Plan API remains authoritative for persistence, linting, quote synchronization, and job snapshotting. The ICM workflow documents the reasoning/context architecture around it.

## Before changing architecture

Read:

- `.ai/CONTEXT.md`
- `.ai/STATE.md`
- `.ai/RULES.md`
- relevant `.ai/workflows/*/CONTEXT.md`
- relevant specialist files under `.ai/specialists/`
- `HANDOFF.md`
- `README.md`

Then inspect the actual implementation. Do not infer current code from old handoff notes.

## Completion standard

A task is not complete merely because files changed. It is complete when the intended behavior is implemented, documented, validated at the appropriate level, and the handoff/state files tell the next agent exactly what changed and what remains.
