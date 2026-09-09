# Project context — Clearview Windows

Paste this into a new Claude session to pick up where the last one left off.
Technical detail lives in [README.md](./README.md); this file is the *why*.

---

## What this is

A marketing site for **Clearview Windows** — my friend Mark's window installation company in Vancouver, WA. He does replacement work for homeowners and new-construction installs for builders, across Clark County and across the river into Portland.

- **Live:** https://windowsbyclearview.com
- **Repo:** `ksksrbiz-arch/windowsbyclearveiw` (public), deploys from `main`
- **Stack:** Astro, static, no adapter. Cloudflare Pages. Estimate form is a Pages Function. Resend for mail.
- **Pricing worker:** https://clearview-pricing.skdev-371.workers.dev
- **Legal entity:** Clear View Windows & Trim LLC (WA UBI 605 779 798), doing business as "Clearview Windows". `site.legalName` in `src/data/site.ts` holds the legal name; `site.name`/`site.shortName` hold the trade name.
- **On the spelling:** the public website uses `windowsbyclearview.com`. The working production mailbox for lead notifications is still on the legacy typo domain `windowsbyclearveiw.com`. Do **not** change the default notification address to `@windowsbyclearview.com` until a real mailbox has been provisioned and tested on that domain. The old domain's HTTP redirect does not affect SMTP/mail delivery.

## Where it stands

Working and deployed:

- Full site: home, replacement, new construction, process, gallery, guides, 8 service-area pages, reviews, estimate, 404
- Real job photos through `astro:assets` (WebP + srcset)
- Estimate form → Resend, with a no-JS fallback and a homeowner/builder split. Both templates (lead-to-Mark and receipt-to-customer) are full HTML with click-to-call / click-to-email buttons, and the lead email attaches a vCard so Mark can save the customer's contact info in one tap.
- **Estimate delivery verified live:** a real public production submission was made through `/estimate`; it returned success, created a D1 lead record, and Resend reported the Mark notification as delivered to the working Google Workspace mailbox at `owner@windowsbyclearveiw.com`.
- A protected Command Center production-mail test is available under `/internal/tools`; it uses the exact production Resend configuration and returns the provider message ID without creating a lead. This remains useful for repeatable diagnostics after deployments.
- Free cost estimator at `/tools/window-replacement-cost-calculator`
- Pricing worker with KV, validation, monthly cron, and a GitHub Actions health check
- Domain migration (windowsbyclearveiw.com → windowsbyclearview.com) is complete for the website: DNS, GTM/GA4, and Cloudflare Pages custom domains are pointed at the canonical web domain. Mail remains on the legacy domain until a real mailbox exists on the new one.

## Rules that must not be broken

These came out of real problems and are easy to undo by accident.

1. **No invented reviews.** `/reviews` is deliberately empty. It previously shipped three fabricated testimonials attributed to named people in a city Mark does not serve. Reviews default to `published: false`. Only real quotes from real customers who agreed, ever.
2. **No invented credentials.** `site.lniNumber` is empty and the footer says the number is pending. Washington requires a contractor registration number in advertising (RCW 18.27.100) and separately **prohibits** advertising that a contractor is "bonded and insured" — that phrase was removed and must stay out.
3. **Pricing must say whose numbers it is.** The estimator currently shows published 2026 Washington / Portland-metro averages, labelled as exactly that on the page, with a review date. When Mark supplies his own ranges, set `basis.source` to `'clearview'` and the copy switches itself. Never present somebody else's averages as ours.
4. **The pricing worker does not discover prices.** There is no authoritative feed for Clark County window pricing. It validates, serves, and nags — it does not scrape cost guides or ask a model to guess.
5. **Honest copy generally.** Plain language, name the weather, admit when condensation is just a humid bathroom. No "unparalleled solutions". The federal 25C tax credit ended for installs after 2025-12-31 — do not sell it.
6. **Client-side navigation stays cheap.** `BaseLayout.astro` navigation handlers run on every in-site navigation. Batch layout reads, then writes; never interleave DOM reads/writes in per-element loops. Defer nonessential analytics work.

## ICM architecture — implemented 2026-09-08

Clearview now has an **ICM (Interpretable Context Methodology) control-plane layer** for AI-assisted operations. It is deliberately not a second database and not a replacement for application code. The filesystem supplies routing, stage contracts, stable reference context, and inspectable working artifacts; D1 and deterministic services remain the transactional/enforcement layer.

### Context layers

- Layer 0 — `CLAUDE.md`: global identity/operating contract.
- Layer 1 — `.ai/CONTEXT.md`: router; points to the smallest relevant context.
- Layer 2 — workflow/specialist `CONTEXT.md`: the contract for the current job.
- Layer 3 — references/authorities: stable knowledge and source material.
- Layer 4 — working records/artifacts: current run state; never secrets or customer PII in ICM files.

**Navigate before reasoning.** A fresh agent should orient, route, act, and report state from the repository without relying on conversation memory.

### Build Plan pipeline

```text
01-scope → 02-openings → 03-materials → 04-installation → 05-qc → 06-approval
```

The production API remains authoritative for persistence/versioning/stale detection/linting/job snapshots: `functions/internal/api/build-plan.js`. Deterministic installation and QC rules live in `functions/_lib/build-plan-rules.mjs`.

The plan deliberately distinguishes:

- **KNOWN** — directly supported by quote/site/product authority.
- **INFERRED** — reasonable classification, not sufficient for commitment.
- **VERIFY** — requires measurement, inspection, order confirmation, manufacturer documentation, or another explicit confirmation.

### Ask routing

`functions/ask/_lib/icm-router.mjs` is the deterministic routing seam for `/ask`. It selects one specialist contract before model reasoning:

- `diagnostician` — symptoms, fog, drafts, moisture, damage
- `estimator` — cost, price, estimate, quote, budget
- `installation-reviewer` — installation, flashing, rough openings, fasteners, new construction
- `customer-advisor` — comparisons, performance, appearance, planning

The router does not answer questions, retrieve knowledge, or bypass runtime guardrails. Regression cases live in `scripts/test-icm-router.mjs`; run `npm run test:icm`.

### Specialists

- `.ai/specialists/diagnostician/`
- `.ai/specialists/estimator/`
- `.ai/specialists/installation-reviewer/`
- `.ai/specialists/customer-advisor/`

These are contracts, not fake personas. Keep identity short, rules falsifiable, references authoritative, workflow explicit, and examples paired as good/bad/edge cases.

### ICM implementation rules

1. One stage, one job.
2. Routers point; they do not duplicate knowledge.
3. Stable factory knowledge belongs in Layer 3; per-run state belongs in Layer 4.
4. Stage N+1 consumes the documented output of Stage N; avoid hidden cross-stage reads.
5. Deterministic code owns calculations, validation, persistence, authorization, and state transitions.
6. AI may classify, reason, summarize, route, or propose, but it cannot turn uncertainty into a business commitment.
7. Human approval is a real state boundary: `draft → review → approved → job snapshot`.
8. Golden cases are executable documentation and should become automated regression coverage.
9. ICM files must never become a shadow customer database.

## Current limitations — explicitly not complete

1. Stage artifacts are documented but the operational Build Plan is still one D1 JSON artifact.
2. Build Plan approval/reconciliation needs a stronger explicit state machine and audit trail.
3. Ask has a deterministic routing seam but runtime prompt/context assembly has not yet fully consumed the specialist contracts.
4. Specialist references need deeper source mapping as the knowledge library grows.
5. Golden cases need end-to-end execution against the real Ask and Build Plan services.
6. Lead → Estimate → Quote → Build Plan → Job → Installation → QC → Closeout is mapped but not every lifecycle stage has an ICM implementation.

Do not describe those items as complete until code and validation prove them.

## Outstanding

| | |
| --- | --- |
| **L&I registration number** | Set `lniNumber` in `src/data/site.ts` when the real registration exists. |
| **Mark's real pricing** | Replace regional averages when actual ranges are supplied. |
| **Canonical-domain mailbox** | Provision and test before changing production mail defaults. |
| **Hero video** | Drop the production clip at `public/video/hero.mp4`. |
| **`ADMIN_TOKEN`** | Optional; worker pricing writes remain closed while unset. |
| **Google Business Profile** | Still needs setup. |
| **Single-color logo glyph** | Commission a simplified flat glyph for embroidery/engraving/one-color applications. |

## How I like to work

- Verify rather than assert — build it, run it, inspect it, then say it works.
- Say plainly when something cannot be done honestly, then build the nearest thing that can.
- Flag your own bugs rather than quietly patching them.
- Push to `main`; Cloudflare Pages deploys automatically.
