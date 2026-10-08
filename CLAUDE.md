# Clearview Windows — Claude Router

Root router for AI agents in this repo. Routing only: detail lives in `.ai/`. Hard cap 80 lines (`npm run test:icm-structure`).
Mission: a trustworthy operating system for Clearview Windows & Trim LLC, not merely a marketing site.

## Non-negotiables

1. **Verify before asserting.** Read the repo, run the relevant tests, inspect live behavior when deployment matters.
2. **Never invent business facts.** No fake reviews, credentials, L&I number, pricing, warranties, specs, measurements, or customer facts.
3. **Deterministic code owns deterministic work.** Validation, math, persistence, authorization, state transitions. AI judges, routes, summarizes, proposes.
4. **Human approval is a state boundary.** AI output is a proposal until explicitly approved.
5. **D1 is transactional truth.** `.ai/` files are context, policy, contracts, references; never business records.
6. **Stop on ambiguity** touching safety, price, ordering, installation, or customer commitments. Surface `VERIFY`.
7. **Explicit stage handoffs.** Stage N+1 consumes the documented output of stage N.
8. **Phone-first internal UX.** Keep Today → Leads → Quotes/Invoices → Jobs → Payments.
9. **Protect domain/mail spelling.** Public web: `windowsbyclearview.com`. Production mail stays on legacy `windowsbyclearveiw.com` until a real mailbox exists on the canonical domain.

## Route the task (load only the row you need)

| Task | Load | Do not load |
|---|---|---|
| Any architecture change | `.ai/CONTEXT.md`, `.ai/STATE.md`, `.ai/RULES.md`, `.ai/references/icm-rules.md` | `HANDOFF.md` history, `CHANGELOG.md` |
| Quote → executable plan | `.ai/workflows/build-plan/CONTEXT.md`, then its stage | specialists, copy references |
| New website inquiry → quote | `.ai/workflows/lead-to-quote/` | build-plan stages |
| Finish and close a job | `.ai/workflows/job-closeout/` | lead-to-quote |
| Customer-facing copy, guides, graphics | `.ai/workflows/public-copy-sweep/`, `.ai/references/public-copy-positioning.md` | internal specialists |
| GA4, GTM, Meta events | `.ai/workflows/analytics-events/` | copy references |
| Ship, deploy, domain or mail change | `.ai/workflows/deploy-check/` | analytics, specialists |
| Direct-mail pilot: refresh the list, read or load Mail pilot data | `.ai/workflows/mail-pilot/` | quote workflows; address data in chat or git |
| `/ask` routing or specialists | `.ai/references/ask-routing.md`, `.ai/specialists/<id>/CONTEXT.md` | workflows |
| New Command Center feature | `.ai/references/command-center-gap-analysis.md` | specialists |
| Install, offline, service worker, manifest (Command Center PWA) | `.ai/references/internal-pwa.md` | workflows, specialists |
| AI feature (provider, budget, tools) | `.ai/AI-OPERATING-CONTRACT.md`, `.ai/RULES.md` | workflows |
| What is the current state? | `.ai/STATE.md`, `.ai/WORKING.md` | `CHANGELOG.md` (history only) |
| Why ICM is shaped this way (method background) | `.ai/references/icm-method-notes.md` | workflows, specialists |
| Why was X built this way? | `.ai/CHANGELOG.md`, `HANDOFF.md`, `docs/ICM-IMPLEMENTATION.md` | everything else |

Exclusion rule: if a file is not in the row's Load column, do not read it speculatively. Open it only when
the task proves it is needed, and say why.

## Orientation

`CLAUDE.md` → `.ai/CONTEXT.md` (router + layers) → one workflow or specialist → its references → state.
This repo keeps the folder name `.ai/` (maps to `context/` in Keith's standard ICM layout; see
`.ai/references/icm-rules.md`). Contracts declare Input / Process / Output / Stop conditions / Completion.

## Verification

GitHub Actions works again (Build, Site smoke, Pricing health, ops-cron deploy; since 2026-10-03). Local runs remain the first gate:
`npm run test:all` (full suite in CI order), then `npm run build`. Cloudflare Pages preview is the
independent build signal. Inspect the live UI for anything deployment-dependent.

## Completion standard

Done means: implemented, documented, validated at the right level, and `.ai/STATE.md` (snapshot),
`.ai/CHANGELOG.md` (dated entry) and `HANDOFF.md` (if the next agent needs it) say what changed and what remains.
