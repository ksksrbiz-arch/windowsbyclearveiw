# Clearview ICM — Working Context

This file is Layer 4: current implementation work. It is intentionally separate from stable rules and identity.

## Current migration

**Phase:** ICM control plane → deterministic routing → Build Plan stage execution → Ask specialist routing → lifecycle coverage.

### Completed

- 2026-10-01 ICM alignment: router-only `CLAUDE.md`, Completion sections everywhere, five new workflows, `STATE.md`/`CHANGELOG.md` split, `test:icm-structure`, `test:all`.

- Root operating contract in `CLAUDE.md`.
- ICM router/context model in `.ai/CONTEXT.md`.
- Stable operating rules in `.ai/RULES.md`.
- Build Plan stage contracts in `.ai/workflows/build-plan/01-scope` through `06-approval`.
- Specialist contracts for diagnostician, estimator, installation reviewer, and customer advisor.
- Build Plan API remains the deterministic source of persistence, versioning, stale detection, and linting.

### Public copy log

- **2026-10-03, new guide `/guides/window-replacement-permit-washington`** (answers "Do you need a permit to replace windows in Washington?"). Written only from primary sources read on 2026-10-03: Clark County residential-permits page and its roofing/siding/windows handout, Camas building FAQ, Battle Ground and Ridgefield permit FAQs, La Center building page (read through the fetch tool, not raw), and the Washington State Energy Code, residential (chapter 51-11R WAC: R503.1.1.1, Table R402.1.3). Reviewed: that guide; the permit sentence in `/guides/window-replacement-cost-washington` (link added, nothing else changed). Not reviewed: everything else on the 2026-09-30 list is unchanged.
- **VERIFY (owner / whoever approves publication):** (1) **Vancouver.** The guide deliberately does not state a Vancouver rule. Search results quote Vancouver Municipal Code 17.08.090 as exempting "replacement of window and door assemblies utilizing existing framed openings and not requiring fire resistive rating in one- and two-family units", but the code site blocks automated reads, so it was never read. Open https://vancouver.municipal.codes/VMC/17.08.090 and, if it says that, add a Vancouver bullet ("same-size replacement in the existing opening is exempt from a building permit") and update the FAQ answers. (2) **Washougal and Woodland.** No window-specific statement was found on Washougal's pages, and Woodland's pages could not be read. Left out. (3) **Camas** wording is slightly ambiguous ("Yes" next to "a permit is generally issued the same day" for like-for-like); the guide says it is a quick permit with no plans. Confirm with the Camas Building Division if that matters. (4) **Whether Clearview pulls permits for the customer** is not stated anywhere in the repo, so the guide only repeats the existing line "We talk through permits with you before work starts." (5) **Fees and timelines** were left out on purpose (the Clark County handout is dated 2018).
- **Ask index:** rebuild with `npm run build:guides-index` (needs `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`) so `/ask` can retrieve the new guide; not done here because those credentials are not available in this environment. Until then Ask answers permit questions without this guide.

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

## Open

- Run step 1 of `workflows/public-copy-sweep/` (inventory customer-facing pages: reviewed vs not reviewed) and record the result here.
- GitHub Actions is blocked by a billing issue; use `npm run test:all` locally.
