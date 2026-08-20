export const site = {
  name: 'Clearveiw Windows, LLC',
  shortName: 'Clearveiw Windows',
  legalName: 'Clearveiw Windows, LLC',
  domain: 'windowsbyclearveiw.com',
  url: 'https://windowsbyclearveiw.com',
  tagline: 'Replacement windows for Vancouver, WA and nearby.',
  description:
    'Clearveiw Windows, LLC installs replacement and new-construction windows in Vancouver, Washington and surrounding Clark County: Camas, Washougal, Battle Ground, Brush Prairie, Ridgefield, La Center, and Woodland — plus Portland, Oregon across the river.',
  owner: 'Mark',
  state: 'Washington',
  email: 'mark.rotar1000@gmail.com',
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
