export const site = {
  name: 'Clearveiw Windows, LLC',
  shortName: 'Clearveiw Windows',
  legalName: 'Clearveiw Windows, LLC',
  domain: 'windowsbyclearveiw.com',
  url: 'https://windowsbyclearveiw.com',
  tagline: 'Replacement windows for Vancouver, WA and nearby.',
  description:
    'Clearveiw Windows, LLC installs replacement and new-construction windows in Vancouver, Washington and surrounding Clark County: Camas, Washougal, Battle Ground, Ridgefield, La Center, and Woodland.',
  owner: 'Mark',
  state: 'Washington',
  email: '',
  phone: '',
  phoneDisplay: 'Call for an estimate',
  address: {
    line1: '',
    city: 'Vancouver',
    region: 'WA',
    postalCode: '',
  },
  serviceArea: 'Vancouver, WA',
  serviceAreaNote:
    'Based in Vancouver, WA. We install throughout Clark County and nearby Woodland.',
  nearby: [
    'Vancouver',
    'Camas',
    'Washougal',
    'Battle Ground',
    'Ridgefield',
    'La Center',
    'Woodland',
  ],
  lniNumber: '',
  hours: 'By appointment',
  social: {
    facebook: '',
    instagram: '',
    google: '',
  },
} as const;

export function telHref() {
  const digits = site.phone.replace(/\D/g, '');
  return digits ? `tel:+1${digits}` : '/estimate';
}
