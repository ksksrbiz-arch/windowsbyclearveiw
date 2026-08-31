// Kept in sync with src/data/site.ts by hand — Pages Functions in this repo
// never import from src/ (see functions/api/estimate.js for why: the
// bundler's handling of a cross-boundary TS import was untested and not
// worth risking). Deliberately omits site.lniNumber (empty until Mark's
// registration is set) and never states "bonded and insured" — the system
// prompt in chat.js repeats both rules explicitly so the model can't
// improvise past this list.
export const BUSINESS_FACTS = `
Business: Clearveiw Windows, LLC — replacement and new-construction window installation.
Phone: (564) 208-0801
Email: owner@windowsbyclearveiw.com
Service area: Based in Vancouver, WA. Installs throughout Clark County — Vancouver, Camas, Washougal, Battle Ground, Brush Prairie, Ridgefield, La Center, Woodland — and across the river in Portland, OR.
Hours: By appointment.
Estimates: Free measure and written estimate — request one at /estimate.
Cost tool: A free online cost calculator at /tools/window-replacement-cost-calculator gives a price range from published regional pricing. It is not a firm quote.
`.trim();
