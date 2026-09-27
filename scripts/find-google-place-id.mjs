#!/usr/bin/env node
// One-time helper: find the Place ID of the Clearview Google Business Profile.
//
//   GOOGLE_PLACES_API_KEY=... node scripts/find-google-place-id.mjs
//
// Optional: pass a different name/phone as arguments.
//   node scripts/find-google-place-id.mjs "Clearview windows and trim LLC" "(564) 208-0801"
//
// Why phone matching: this business shares a near-identical trade name with
// other window companies in the same service area, so a name-only match is not
// safe. Only a result whose phone digits match is printed as the MATCH. Any
// other result is listed as "not a match" so a wrong ID is never copied blindly.

const key = process.env.GOOGLE_PLACES_API_KEY;
const name = process.argv[2] || 'Clearview windows and trim LLC';
const phone = process.argv[3] || '(564) 208-0801';

if (!key) {
  console.error('Set GOOGLE_PLACES_API_KEY first (the same key you will add to Cloudflare Pages).');
  process.exit(2);
}

const digits = (v) => String(v || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-goog-api-key': key,
    'x-goog-fieldmask': 'places.id,places.displayName,places.nationalPhoneNumber,places.formattedAddress,places.rating,places.userRatingCount',
  },
  body: JSON.stringify({
    textQuery: `${name} Vancouver WA`,
    locationBias: { circle: { center: { latitude: 45.6387, longitude: -122.6615 }, radius: 50000 } },
  }),
});

if (!response.ok) {
  console.error(`Places API returned ${response.status}. Check the key is enabled for "Places API (New)".`);
  process.exit(1);
}

const { places = [] } = await response.json();
const wanted = digits(phone);
let matched = 0;

for (const place of places) {
  const isMatch = digits(place.nationalPhoneNumber) === wanted;
  if (isMatch) matched += 1;
  console.log(
    `${isMatch ? 'MATCH      ' : 'not a match'}  ${place.id}  ${place.displayName?.text ?? '?'}  ` +
      `${place.nationalPhoneNumber ?? 'no phone'}  ${place.rating ?? '-'}★ (${place.userRatingCount ?? 0})`,
  );
}

if (matched === 0) {
  console.error('\nNo result matched the phone number. Do not guess. Use Google\'s Place ID Finder instead.');
  process.exit(1);
}
console.log('\nSet the MATCH id as GOOGLE_PLACE_ID in Cloudflare Pages -> Settings -> Variables and Secrets.');
