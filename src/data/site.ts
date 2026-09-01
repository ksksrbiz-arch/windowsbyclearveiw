export const site = {
  name: 'Clearveiw Windows',
  shortName: 'Clearveiw Windows',
  legalName: 'Clear View Windows & Trim LLC',
  /**
   * Washington Unified Business Identifier. Distinct from lniNumber (the WA
   * L&I contractor registration, which is separate and still pending).
   */
  ubiNumber: '605 779 798',
  domain: 'windowsbyclearveiw.com',
  url: 'https://windowsbyclearveiw.com',
  tagline: 'Great prices. Clean work. Clear windows.',
  /**
   * Long form, for the JSON-LD business entity where length does not matter.
   */
  description:
    'Clearveiw Windows, operated by Clear View Windows & Trim LLC, installs replacement and new-construction windows in Vancouver, Washington and surrounding Clark County: Camas, Washougal, Battle Ground, Brush Prairie, Ridgefield, La Center, and Woodland — plus Portland, Oregon across the river.',
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
  serviceAreaNote:
    'Based in Vancouver, WA. We install throughout Clark County, north to Woodland, and across the river in Portland.',
  // Region travels with the city so the schema does not park Portland in Washington.
  nearby: [
    { name: 'Vancouver', region: 'WA', state: 'Washington' },
    { name: 'Camas', region: 'WA', state: 'Washington' },
    { name: 'Washougal', region: 'WA', state: 'Washington' },
    { name: 'Battle Ground', region: 'WA', state: 'Washington' },
    { name: 'Brush Prairie', region: 'WA', state: 'Washington' },
    { name: 'Ridgefield', region: 'WA', state: 'Washington' },
    { name: 'La Center', region: 'WA', state: 'Washington' },
    { name: 'Woodland', region: 'WA', state: 'Washington' },
    { name: 'Portland', region: 'OR', state: 'Oregon' },
  ],
  lniNumber: '',
  hours: 'By appointment',
  social: {
    facebook: '',
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
