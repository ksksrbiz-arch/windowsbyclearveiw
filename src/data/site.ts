export const site = {
  name: 'Clearveiw Windows, LLC',
  shortName: 'Clearveiw Windows',
  legalName: 'Clearveiw Windows, LLC',
  domain: 'windowsbyclearveiw.com',
  url: 'https://windowsbyclearveiw.com',
  tagline: 'Replacement windows installed for Washington homes.',
  description:
    'Clearveiw Windows, LLC installs energy-efficient replacement windows for homeowners across Washington. Local crew, clean job sites, and a straightforward estimate.',
  owner: 'Mark',
  state: 'Washington',
  email: '',
  phone: '',
  phoneDisplay: 'Call for an estimate',
  address: {
    line1: '',
    city: '',
    region: 'WA',
    postalCode: '',
  },
  serviceAreaNote: 'Serving homeowners throughout Washington. City list is a starting set — prune or add to match where Mark actually works.',
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
