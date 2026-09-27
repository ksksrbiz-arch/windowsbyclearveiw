import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGoogleReviews, normalizePlace, FIELD_MASK, MAX_REVIEWS } from '../functions/_lib/google-reviews.mjs';

const pass = (message) => console.log(`PASS: ${message}`);
const NAME = 'Clearview windows and trim LLC';
const PLACE_ID = 'ChIJ_testPlaceId123456789';
const KEY = 'AIza-test-key-should-never-leak';

const placePayload = (overrides = {}) => ({
  id: PLACE_ID,
  displayName: { text: NAME },
  rating: 5,
  userRatingCount: 1,
  googleMapsUri: 'https://maps.google.com/?cid=123',
  reviews: [
    {
      rating: 5,
      text: { text: 'Translated text', languageCode: 'en' },
      originalText: { text: 'Great crew, clean work.\n\n\n\nOn time.', languageCode: 'en' },
      relativePublishTimeDescription: 'a week ago',
      publishTime: '2026-09-18T15:04:05Z',
      authorAttribution: {
        displayName: 'Pat Q.',
        uri: 'https://www.google.com/maps/contrib/123',
        photoUri: 'https://lh3.googleusercontent.com/a/x',
      },
    },
  ],
  ...overrides,
});

const okFetch = (payload, calls = []) => async (url, init) => {
  calls.push({ url, init });
  return { ok: true, status: 200, json: async () => payload };
};

// --- configuration failures never call Google and never throw ---------------
{
  let called = false;
  const spy = async () => { called = true; };
  assert.deepEqual(await loadGoogleReviews({}, spy), { status: 'unconfigured', reviews: [] });
  assert.deepEqual(await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY }, spy), { status: 'unconfigured', reviews: [] });
  assert.deepEqual(await loadGoogleReviews({ GOOGLE_PLACE_ID: PLACE_ID }, spy), { status: 'unconfigured', reviews: [] });
  assert.equal(called, false);
  pass('missing key or place id is "unconfigured" and makes no network call');
}

{
  const result = await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: '../../evil?x=1' }, async () => { throw new Error('must not fetch'); });
  assert.equal(result.status, 'unconfigured');
  pass('a malformed place id cannot be used to alter the request path');
}

// --- request shape ----------------------------------------------------------
{
  const calls = [];
  await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID }, okFetch(placePayload(), calls));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(`https://places.googleapis.com/v1/places/${PLACE_ID}`));
  assert.ok(!calls[0].url.includes(KEY), 'key must not appear in the URL');
  assert.equal(calls[0].init.headers['x-goog-api-key'], KEY);
  assert.equal(calls[0].init.headers['x-goog-fieldmask'], FIELD_MASK);
  assert.ok(!/photos|nationalPhoneNumber|formattedAddress/.test(FIELD_MASK), 'field mask stays minimal to avoid extra billing');
  pass('key travels only in a header and the field mask is minimal');
}

// --- happy path and sanitising ---------------------------------------------
{
  const result = await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID }, okFetch(placePayload()));
  assert.equal(result.status, 'ok');
  assert.equal(result.rating, 5);
  assert.equal(result.count, 1);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0].text, 'Great crew, clean work.\n\nOn time.', 'prefers original text and collapses blank runs');
  assert.equal(result.reviews[0].author, 'Pat Q.');
  assert.equal(result.reviews[0].published, '2026-09-18');
  assert.equal(JSON.stringify(result).includes(KEY), false);
  pass('normalizes a real-shaped place response without leaking the key');
}

{
  const hostile = placePayload({
    reviews: [
      {
        rating: 9,
        originalText: { text: '<img src=x onerror=alert(1)>nice' },
        authorAttribution: { displayName: '<b>x</b>', uri: 'javascript:alert(1)', photoUri: 'http://evil.example/p.png' },
      },
      { rating: 5, originalText: { text: '   ' } },
      { rating: 'nope', originalText: { text: 'no rating' } },
      { rating: 4, originalText: { text: 'ok' }, authorAttribution: { uri: 'https://evil.example/google.com' } },
    ],
  });
  const out = normalizePlace(hostile, { expectedName: NAME });
  assert.equal(out.reviews.length, 2, 'blank text and non-numeric ratings are dropped');
  assert.equal(out.reviews[0].rating, 5, 'ratings are clamped to 1..5');
  assert.equal(out.reviews[0].authorUrl, '', 'javascript: author links are dropped');
  assert.equal(out.reviews[0].authorPhoto, '', 'non-https / non-Google photo hosts are dropped');
  assert.equal(out.reviews[1].authorUrl, '', 'look-alike hosts are dropped');
  assert.equal(out.reviews[1].author, 'Google user');
  pass('hostile review content is neutralised at the API boundary');
}

{
  const many = placePayload({ reviews: Array.from({ length: 12 }, (_, i) => ({ rating: 5, originalText: { text: `r${i}` } })) });
  assert.equal(normalizePlace(many, { expectedName: NAME }).reviews.length, MAX_REVIEWS);
  assert.equal(normalizePlace(placePayload({ reviews: [{ rating: 5, originalText: { text: 'x'.repeat(5000) } }] }), { expectedName: NAME }).reviews[0].text.length, 1200);
  pass('review count and text length are bounded');
}

// --- wrong business fails closed (name collision protection) ----------------
{
  const wrong = placePayload({ displayName: { text: 'ClearView Windows & Doors' } });
  const result = await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID }, okFetch(wrong));
  assert.deepEqual(result, { status: 'name-mismatch', reviews: [] });
  const relaxed = await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID, GOOGLE_PLACE_EXPECTED_NAME: 'clearview WINDOWS & doors' }, okFetch(wrong));
  assert.equal(relaxed.status, 'ok', 'name comparison ignores case and punctuation');
  pass('a Place ID that resolves to a different business shows nothing');
}

// --- upstream failures ------------------------------------------------------
{
  const denied = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: `API key ${KEY} invalid` } }) });
  const a = await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID }, denied);
  assert.deepEqual(a, { status: 'unavailable', reviews: [] });
  const b = await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID }, async () => { throw new Error(`boom ${KEY}`); });
  assert.deepEqual(b, { status: 'unavailable', reviews: [] });
  const c = await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID }, async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }));
  assert.equal(c.status, 'unavailable');
  pass('API errors, network errors and bad JSON degrade to "unavailable" without echoing anything');
}

{
  const empty = await loadGoogleReviews({ GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID }, okFetch(placePayload({ reviews: undefined, userRatingCount: 0, rating: undefined })));
  assert.equal(empty.status, 'ok');
  assert.deepEqual(empty.reviews, []);
  pass('a profile with zero reviews returns ok with an empty list (page keeps its empty state)');
}

// --- handler: caching, methods, headers -------------------------------------
{
  const store = new Map();
  globalThis.caches = {
    default: {
      match: async (req) => store.get(req.url)?.clone(),
      put: async (req, res) => { store.set(req.url, res); },
    },
  };
  const realFetch = globalThis.fetch;
  let upstream = 0;
  globalThis.fetch = async () => { upstream += 1; return { ok: true, status: 200, json: async () => placePayload() }; };

  const { onRequest } = await import('../functions/api/google-reviews.js');
  const env = { GOOGLE_PLACES_API_KEY: KEY, GOOGLE_PLACE_ID: PLACE_ID, GOOGLE_REVIEWS_TTL_SECONDS: '1' };
  const ctx = (method = 'GET') => ({ request: new Request('https://windowsbyclearview.com/api/google-reviews', { method }), env });

  const first = await onRequest(ctx());
  const body = await first.json();
  assert.equal(first.status, 200);
  assert.equal(body.status, 'ok');
  assert.match(first.headers.get('cache-control'), /s-maxage=300/, 'TTL is clamped to a 5 minute floor');
  assert.equal(first.headers.get('x-content-type-options'), 'nosniff');
  await onRequest(ctx());
  assert.equal(upstream, 1, 'second request is served from cache');

  const post = await onRequest(ctx('POST'));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');

  store.clear();
  const bare = await onRequest({ request: new Request('https://windowsbyclearview.com/api/google-reviews'), env: {} });
  assert.equal((await bare.json()).status, 'unconfigured');
  assert.match(bare.headers.get('cache-control'), /s-maxage=300/, 'failures are cached only briefly');

  globalThis.fetch = realFetch;
  delete globalThis.caches;
  pass('handler caches good responses, rejects non-GET, and fails soft when unconfigured');
}

// --- front-end contract (static checks) ------------------------------------
{
  const component = fs.readFileSync('src/components/GoogleReviews.astro', 'utf8');
  const page = fs.readFileSync('src/pages/reviews.astro', 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(component), 'review text is never parsed as HTML');
  assert.ok(/textContent/.test(component), 'review text is written with textContent');
  assert.ok(/data-google-reviews[\s\S]*\bhidden\b/.test(component), 'section is hidden until real reviews arrive');
  assert.ok(/status !== 'ok'/.test(component), 'section only shows for status ok');
  assert.ok(/<GoogleReviews \/>/.test(page), '/reviews renders the Google reviews section');
  assert.ok(/data-hide-when-google-reviews/.test(page), 'the "nothing here yet" block is hidden when Google reviews render');
  assert.ok(!/aggregateRating|AggregateRating/.test(component + page), 'no self-serving review markup is emitted');
  pass('front-end never injects HTML, hides itself by default, and adds no review schema');
}

console.log('Google reviews checks passed.');
