// Kept in sync with src/data/site.ts by hand — Pages Functions in this repo
// never import from src/ (see functions/api/estimate.js for why: the
// bundler's handling of a cross-boundary TS import was untested and not
// worth risking). Deliberately omits site.lniNumber even though it is now
// set — chat.js's HARD_BANNED filter scrubs any L&I/license number from
// conversational output on purpose, so the real number stays on the
// deterministic site (footer, JSON-LD, contracts) rather than in freeform
// AI text — and never states "bonded and insured". The system prompt in
// chat.js repeats both rules explicitly so the model can't improvise past
// this list.
//
// The "Cost tool" line below says whose pricing basis the calculator uses —
// it must match pricing.ts's basis.source ('clearview' right now). If that
// ever reverts to 'averages', reword the line back to "published regional
// pricing" rather than letting it silently drift out of sync again.
export const BUSINESS_FACTS = `
Business: Clearview Windows, operated by Clearview Windows & Trim LLC — replacement windows, sliding glass doors, and new-construction window installation.
Phone: (564) 208-0801
Email: owner@windowsbyclearveiw.com
Service area: Based in Vancouver, WA. Installs throughout Clark County — Vancouver, Camas, Washougal, Battle Ground, Brush Prairie, Ridgefield, La Center, Woodland. Does not serve Portland, OR or other Oregon locations.
Hours: By appointment.
Estimates: Free measure and written estimate — request one at /estimate.
Pricing: Clearview does not publish prices. Every opening is measured in person and the price is given in a written estimate. The free project planner at /tools/window-replacement-cost-calculator lets a visitor list their openings and send them straight into the quote request at /estimate.
Facebook: https://www.facebook.com/share/18pyB4MHkS/
`.trim();
