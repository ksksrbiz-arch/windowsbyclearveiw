export const site = {
  name: 'Clearview Windows',
  shortName: 'Clearview Windows',
  legalName: 'Clear View Windows & Trim LLC',
  /**
   * Washington Unified Business Identifier. Distinct from lniNumber (the WA
   * L&I contractor registration).
   */
  ubiNumber: '605 779 798',
  domain: 'windowsbyclearview.com',
  url: 'https://windowsbyclearview.com',
  tagline: 'Great prices. Clean work. Clear windows.',
  /**
   * Long form, for the JSON-LD business entity where length does not matter.
   */
  description:
    'Clearview Windows, operated by Clear View Windows & Trim LLC, installs replacement windows, sliding glass doors, and new-construction windows in Vancouver, Washington and surrounding Clark County: Camas, Washougal, Battle Ground, Brush Prairie, Ridgefield, La Center, and Woodland.',
  /**
   * Short form, for the homepage <meta name="description">. Google truncates
   * around 160 characters and the long version was 253, so the service-area
   * list — the part that actually earns the click — was being cut off.
   */
  metaDescription:
    'Replacement and new-construction windows in Vancouver, WA and Clark County — Camas, Washougal, Battle Ground and nearby. Free measure, written estimate.',
  owner: 'Mark',
  state: 'Washington',
  /**
   * The address published on the site — footer, legal pages, and the JSON-LD
   * business entity. Deliberately not the same mailbox estimate requests land
   * in: this one is public and will attract scrapers, and leads should not
   * share an inbox with whatever that brings.
   */
  email: 'owner@windowsbyclearveiw.com',
  phone: '(564) 208-0801',
  phoneDisplay: '(564) 208-0801',
  address: {
    line1: '',
    city: 'Vancouver',
    region: 'WA',
    postalCode: '',
  },
  serviceArea: 'Vancouver, WA',
  serviceAreaNote: 'Based in Vancouver, WA. We install throughout Clark County, north to Woodland.',
  nearby: [
    { name: 'Vancouver', region: 'WA', state: 'Washington' },
    { name: 'Camas', region: 'WA', state: 'Washington' },
    { name: 'Washougal', region: 'WA', state: 'Washington' },
    { name: 'Battle Ground', region: 'WA', state: 'Washington' },
    { name: 'Brush Prairie', region: 'WA', state: 'Washington' },
    { name: 'Ridgefield', region: 'WA', state: 'Washington' },
    { name: 'La Center', region: 'WA', state: 'Washington' },
    { name: 'Woodland', region: 'WA', state: 'Washington' },
  ],
  lniNumber: 'CLEARVW74601',
  /**
   * Commercial general liability insurance, from the ACORD 25 certificate on
   * file (Certificate #992928302, issued 2026-09-16). Drives InsuranceTag
   * the same way lniNumber drives LicenseTag — set to null and the tag
   * renders nothing rather than guessing at coverage.
   */
  insurance: {
    carrier: 'State National Insurance Company',
    policyNumber: 'NXTCDKDFTC-00-GL',
    perOccurrence: 300_000,
    generalAggregate: 300_000,
    effectiveDate: '2026-09-16',
    expirationDate: '2027-09-16',
  } as { carrier: string; policyNumber: string; perOccurrence: number; generalAggregate: number; effectiveDate: string; expirationDate: string } | null,
  /**
   * WA L&I continuous contractor's surety bond, required alongside
   * lniNumber under RCW 18.27.040 — the statutory bond, distinct from and
   * much smaller than the liability insurance above. Drives BondTag the
   * same way. Bond #568672F, effective 2026-09-15.
   */
  bond: {
    surety: 'Westfield Insurance Company',
    bondNumber: '568672F',
    amount: 30_000,
    effectiveDate: '2026-09-15',
  } as { surety: string; bondNumber: string; amount: number; effectiveDate: string } | null,
  hours: 'By appointment',
  social: {
    facebook: 'https://www.facebook.com/share/18pyB4MHkS/',
    // Set once Mark's Instagram profile is live — every link below reads
    // from this field and disappears on its own while it is empty.
    instagram: '',
    google: '',
  },
} as const;

export function phoneDigits() {
  return site.phone.replace(/\D/g, '');
}

export function telHref() {
  const digits = phoneDigits();
  return digits ? `tel:+1${digits}` : '/estimate';
}

export function mailHref() {
  return site.email ? `mailto:${site.email}` : '/estimate';
}
