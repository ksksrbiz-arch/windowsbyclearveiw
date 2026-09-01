/**
 * Contract terms printed on every quote from the internal tool.
 *
 * ── This has not been reviewed by an attorney ───────────────────────────────
 * The wording below is standard, commonly-used boilerplate for a residential
 * home-improvement contract in Washington — not something invented from
 * nothing, but also not something a lawyer has checked against Clearveiw's
 * actual practices. Three things specifically need a second look before this
 * is used for a real, binding signature:
 *
 *  1. WARRANTY_YEARS and the warranty wording — confirm what Mark actually
 *     wants to stand behind.
 *  2. The right-to-cancel notice. Washington's Home Solicitation Sales Act
 *     (and the FTC's parallel Cooling-Off Rule) require a right to cancel
 *     within 3 business days for a contract signed somewhere other than the
 *     seller's permanent place of business — which describes every contract
 *     this tool will produce, since Mark signs jobs at the customer's home.
 *     Leaving this out would very likely make a signed contract legally
 *     defective. It is included here in close-to-standard form; it should
 *     not be shortened or removed without a lawyer's sign-off.
 *  3. Payment terms are deliberately generic — this tool does not invent a
 *     deposit percentage or payment schedule Mark has not actually decided
 *     on.
 *
 * TERMS_VERSION is stamped onto every saved quote. If this wording changes,
 * bump it — a quote's printed record should always reflect what the
 * customer actually saw and signed, not whatever the wording says today.
 */

import { site } from './site';

export const TERMS_VERSION = '2026-08-28';

export const WARRANTY_YEARS = 1;

export const contractTerms = {
  paymentTerms:
    `Payment is due as agreed in writing between ${site.legalName} and the customer. ` +
    'No deposit is collected as part of this document; any deposit or payment schedule will ' +
    'be stated separately before work begins.',

  changeOrders:
    'Any change to the scope of work described above must be agreed to in writing by both ' +
    'parties and may adjust the total price and completion date.',

  warranty:
    `Workmanship is warranted for ${WARRANTY_YEARS} year${WARRANTY_YEARS === 1 ? '' : 's'} from ` +
    'the date work is completed. Windows and materials carry the manufacturer’s own warranty; ' +
    `${site.legalName} will assist in facilitating a manufacturer warranty claim but does ` +
    'not itself extend or replace it.',

  delays:
    `${site.legalName} is not responsible for delays caused by material availability, ` +
    'weather, or conditions discovered once work begins (including but not limited to rot or ' +
    'structural damage not visible at the time of this estimate). The customer will be notified ' +
    'promptly if a delay or a change in scope becomes necessary.',

  governingLaw:
    'This agreement is governed by the laws of the State of Washington. Any dispute arising ' +
    'from this agreement will be brought in the state or federal courts serving Clark County, ' +
    'Washington.',

  // Close to the FTC's model "Notice of Cancellation" language, which is the
  // safer choice here rather than a shortened paraphrase.
  rightToCancel: {
    heading: 'Notice of right to cancel',
    body: [
      'You may cancel this transaction, without any penalty or obligation, within THREE ' +
        'BUSINESS DAYS from the date on which you sign this contract.',
      `To cancel, you must notify ${site.legalName} in writing, by mail or email, before ` +
        'midnight of the third business day after the date of this contract. Notice sent by ' +
        'mail is effective when postmarked.',
      'If you cancel, any payment made and any goods traded in will be returned within 10 days ' +
        'of receipt of your cancellation notice, and any security interest arising from the ' +
        'transaction will be cancelled.',
    ],
  },

  acknowledgement:
    'By signing below, both parties agree to the scope of work, price, and terms stated in ' +
    'this document.',
};
