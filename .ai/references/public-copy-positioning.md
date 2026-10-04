# Public copy positioning

Load this before writing or reviewing customer-facing copy, guides, city pages, or graphics.
Owner direction, 2026-09-30. Business facts here come from the owner; do not extend them by guessing.

## Who the site is talking to

- Clearview replaces windows for a **wide variety of reasons**. Copy should reflect that range, not one story.
- The jobs Clearview is prioritising early on are the ones with the simplest installs, typically
  **houses roughly 10–15 years old** replacing their existing window units. This is an internal targeting
  note: do not publish it as a restriction, an age cutoff, or a claim about what we will not do.
- Older homes and single-pane windows are still work Clearview does. Existing single-pane mentions
  may stay as one example among several. Do **not** make single-pane, old wood sashes, or "very old
  windows" the headline or the only reason given for replacement, and do not add new copy built
  around that premise.
- Do not invent the specific failure reasons for 10–15-year-old units. Use reasons already on the
  site (fogged glass/failed seals, drafts, hard-to-operate sashes, condensation, damage at the
  opening) or ask the owner.

## Terminology and voice (enforced by `npm run test:public-terminology`)

- Never describe the install method (no "full-frame", "insert", "block frame", "nail fin",
  "block and fin", "pocket" install). Say "we measure every opening and tell you the right approach
  in the written estimate."
- Say "old", not "tired", for windows.
- The company has no DBA on file. Never write "doing business as" or "d/b/a"; use the legal name Clearview Windows & Trim LLC.
- No personal names in public copy; company voice ("we"). No claims about team size.
- Never promise how long a job takes or what state the room is left in. No "one-day job", "same day",
  or "leave the room usable" (owner direction, 2026-09-30: timing depends on the specifics of each job).
  Saying we haul away debris is fine. Lead times are fine when tied to the manufacturer.

## Siding (owner direction, 2026-10-04)

Source of truth for `/siding` and anything else that mentions siding; do not extend by guessing.

- **Products:** fiber cement lap and board and batten, primarily James Hardie; LP siding products such as LP SmartSide board; other wood siding products. Windows can be done on a siding job if the customer asks.
- **Price:** charged by the square foot. **Labor only** (the siding material is a separate cost quoted in the estimate): starting at $2 per sq ft on new construction, $3 on an existing home, $4 for board and batten. Values live in `src/data/siding.ts`. Say "labor starts at", never "installed from" and never a total.
- **Warranty:** the manufacturer's. James Hardie, and most other siding products, carry a manufacturer's warranty when the product is bought, as long as it is installed to the manufacturer's specifications. Publish no term length: the owner said 25 years, but James Hardie's published HardiePlank warranty says 30 (ColorPlus finish 15), so the number is VERIFY against Hardie's current paperwork. No Clearview workmanship warranty is stated.
- Still not stated anywhere: certifications (no "certified installer"), crew or experience claims, job duration.

## Graphics

- AI-generated window diagrams have repeatedly come out wrong. Two were removed on 2026-09-30
  (interior shown with siding, hardware on both sides, low quality); a Canva redraft was rejected for
  a single-pane premise. Treat any generated window illustration as a draft, never as shippable.
- Any new diagram must be checked by the owner/installer before it ships. Diagrams showing an
  "old vs new" comparison must match the positioning above (not a single-pane-only story).
- Kept and verified accurate: the double-pane glass guide graphic and the vinyl-vs-fiberglass graphic.
