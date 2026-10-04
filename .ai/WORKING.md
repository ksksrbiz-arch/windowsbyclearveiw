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

- **2026-10-04, new page `/siding`** (Mark wants a dedicated house-siding page for the same eight areas). Owner-supplied facts only (also recorded in `.ai/references/public-copy-positioning.md` "Siding"): fiber cement lap and board and batten, primarily James Hardie; LP products such as SmartSide board; other wood siding products; windows on a siding job on request; labor starts at $2/sq ft new construction, $3/sq ft existing home, board and batten $3/sq ft new construction and $4/sq ft existing home, cedar $4/sq ft (per square foot of total wall area, height times width), tear-off and new plywood $2/sq ft, significant suspected dry rot adds roughly $1,000-$2,000 (labor only, material separate; `src/data/siding.ts`); the manufacturer's warranty with no term stated; four owner-supplied siding photos. Permit section read from primary sources on 2026-10-04: Clark County (permit required to replace any siding, RSW permit, from its residential-permits page), Camas (residential roof & siding listed as needing a permit), Battle Ground and Ridgefield (reroofing/siding listed as needing one). La Center publishes no siding line; Vancouver, Washougal and Woodland were not verified, so the page defers those to the building department. Reviewed: that page, plus one-line siding links on home, `/replacement`, the footer, every city page (template) and the business JSON-LD. Guarded by `npm run test:siding` (only the owner figures, never called installed prices; no warranty term, certification, name or crew claim; the four photos render, carry no EXIF, and appear in the gallery).
- **VERIFY (siding, owner):** (1) **Photos.** Four siding-job photos were supplied 2026-10-04 and are on the page and in the gallery. Prepared for publishing: metadata stripped, one door number blurred, one person cropped out. Captions say only what is visible; two shots are mid-job (house wrap; tan panels over a brick building with a debris pile in front), so Mark should confirm he is happy showing those, and that the customers are fine with their properties appearing. (2) **Process steps** (walkthrough and measure, written estimate, the work, final walkthrough) mirror the window process; Mark should confirm they describe how siding jobs actually run. (3) **Windows with siding** is stated only as "we can, if you ask"; no bundle price or scheduling promise. A bundled offer is the strongest local angle found in the SERP check, so ask Mark if he wants one. (4) **Warranty term.** The owner said 25 years; James Hardie's published HardiePlank warranty (found by search, not read from Hardie's site) says 30 years, 15 on the ColorPlus finish. The page states no term. Confirm against Hardie's current paperwork before adding a number. Manufacturer certifications and any Clearview workmanship warranty are not stated. (5) **Per-sq-ft basis.** The rates are labor starting prices (owner, 2026-10-04); Mark confirmed the square foot is total wall area, height times width, and board and batten is $3 on new construction and $4 on an existing home (both confirmed by Mark, 2026-10-04), so only the cedar rate's job type remains to confirm (the page says cedar starts at $4 without a job type). Mark's later texts: "Tear off and re installing new plywood is 2 per sq ft" (the page calls this labor, flat, by analogy with the other rates: confirm the plywood itself is not included), "Cedar siding starts at 4 per sq ft", and "If there is significant suspected dry rot it will add roughly 1k to 2k more" (the page says it adds roughly $1,000 to $2,000 to the job; confirm what the range covers). (6) **Who pulls the siding permit** is not stated anywhere in the repo. (7) **Header nav.** Adding "Siding" to the header collides with the logo and Facebook icon at 1440px (the 10-link nav already fits with about 3px to spare), so it is in the footer, home page, replacement page and city pages only; a "Services" menu is the clean fix and needs a design decision. (8) **/ask** and the Ask index do not know about siding yet; `/ask` is the window consultant.
- **Siding 90-day review (audit-survival):** siding requests arrive with the note "House siding" (the CTA passes `?scope=House%20siding`). Count those in `/internal` leads at 90 days (around 2027-01-02). If there are no qualified siding inquiries, fold the page into a services section rather than extending it. Do not build siding line items, a siding quote template, per-city siding pages or an Ask specialist before a siding job sells.

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
