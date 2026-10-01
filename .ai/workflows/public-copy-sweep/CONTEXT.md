# Workflow: Public copy sweep

Review or write customer-facing copy (pages, guides, city pages, graphics, Ask knowledge) so it matches the
owner's positioning and never states an invented business fact.

## Load / exclude

| Load | Do not load |
|---|---|
| `.ai/references/public-copy-positioning.md` (owner direction; do not extend by guessing) | internal specialists, Build Plan stages |
| `scripts/test-public-terminology.mjs` (the enforced rules) | `src/pages/internal/**` (exempt from customer-copy rules) |
| `README.md` → "Plain-language pass (2026-09-30)" for what was already done | `HANDOFF.md` history |

## Input

- A scope: a page list, or "everything customer-facing" (`src/pages`, `src/components`, `src/content`,
  `src/data`, `functions/ask/_data`, minus `src/pages/internal`).
- The positioning reference and the banned-term rules.

## Process

1. **Inventory first.** List every customer-facing page in scope and mark it `done` / `not reviewed` against
   the 2026-09-30 plain-language pass (home, `/replacement`, `/process`, `/sliding-glass-doors`,
   `/window-features`, `/about`, eight city pages, six guides, gallery, reviews, service-area index, tools
   index, estimate problem page, 404). Anything not on that list is `not reviewed`; do not assume.
2. Review one page at a time against the positioning reference: wide range of replacement reasons, no
   single-pane-only headline, no install-method names, "old" not "tired", no DBA wording, no personal names
   or team-size claims, no job-timing or room-state promises.
3. Edit body copy only. Titles, meta descriptions, FAQs and business facts are not changed without owner say-so.
4. Any fact you cannot source from the repo or the reference becomes a `VERIFY` question for the owner;
   never fill it in. Never add reviews, credentials, prices, warranties or specs.
5. Any generated window illustration is a draft; it needs owner/installer review before it ships.
6. If a guide changed, rebuild the Ask index: `npm run build:guides-index` (needs `GEMINI_API_KEY`).

## Output

- Edited copy in the repo.
- A short list: pages reviewed, pages still `not reviewed`, and open owner questions (`VERIFY`).

## Stop conditions

A change needs a business fact you do not have; a rule in the reference conflicts with the existing page
and the owner has not decided; a graphic's accuracy is in doubt.

## Completion

Done when: `npm run test:public-terminology`, `npm run test:seo` and `npm run build` pass locally; the
reviewed / not-reviewed list is written into `.ai/WORKING.md`; open owner questions are listed for Keith;
and any graphic is marked "awaiting owner/installer review" or "approved". A human (Keith or Mark) approves
publication; the sweep itself never does.
