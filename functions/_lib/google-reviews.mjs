// Google Business Profile reviews -> a small, safe, public JSON shape.
//
// Design rules (see CLAUDE.md non-negotiable #2, "never invent business facts"):
//   * Only reviews that Google actually returns for ONE pinned Place ID are shown.
//   * The pinned place's display name must match GOOGLE_PLACE_EXPECTED_NAME.
//     This business shares a near-identical trade name with other window
//     companies in the same service area (see HANDOFF.md, 2026-09-16), so a
//     wrong Place ID must fail closed instead of showing a competitor's praise.
//   * Text is passed through as plain text. The browser renders it with
//     textContent, never innerHTML.
//   * Nothing here ever throws to the caller and nothing echoes the API key.

export const PLACES_ENDPOINT = 'https://places.googleapis.com/v1/places/';

// Places API (New) field mask. Fields beyond this are billed and unused.
export const FIELD_MASK = [
  'id',
  'displayName',
  'rating',
  'userRatingCount',
  'googleMapsUri',
  'reviews.rating',
  'reviews.text',
  'reviews.originalText',
  'reviews.publishTime',
  'reviews.relativePublishTimeDescription',
  'reviews.authorAttribution',
].join(',');

export const MAX_REVIEWS = 5; // Places API returns at most 5.
export const MAX_TEXT = 1200;
export const MAX_NAME = 80;

const GOOGLE_HOSTS = /(^|\.)google\.com$/i;
const GOOGLE_IMAGE_HOSTS = /(^|\.)(googleusercontent\.com|ggpht\.com)$/i;

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function safeUrl(value, hostPattern) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return '';
    if (!hostPattern.test(url.hostname)) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function normalizeName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clampRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n * 10) / 10));
}

/**
 * Turn a Places API (New) place object into the public shape.
 * Returns { status: 'ok' | 'name-mismatch', ... }.
 */
export function normalizePlace(place, { expectedName = '' } = {}) {
  const displayName = cleanText(place?.displayName?.text, 160);

  if (expectedName && normalizeName(displayName) !== normalizeName(expectedName)) {
    return { status: 'name-mismatch', reviews: [] };
  }

  const reviews = (Array.isArray(place?.reviews) ? place.reviews : [])
    .slice(0, MAX_REVIEWS)
    .map((r) => {
      const text = cleanText(r?.originalText?.text || r?.text?.text, MAX_TEXT);
      const rating = clampRating(r?.rating);
      if (!text || rating === null) return null;
      const author = r?.authorAttribution || {};
      return {
        rating: Math.round(rating),
        text,
        author: cleanText(author.displayName, MAX_NAME) || 'Google user',
        authorUrl: safeUrl(author.uri, GOOGLE_HOSTS),
        authorPhoto: safeUrl(author.photoUri, GOOGLE_IMAGE_HOSTS),
        when: cleanText(r?.relativePublishTimeDescription, 60),
        published: /^\d{4}-\d{2}-\d{2}T/.test(String(r?.publishTime || ''))
          ? String(r.publishTime).slice(0, 10)
          : '',
      };
    })
    .filter(Boolean);

  return {
    status: 'ok',
    name: displayName,
    rating: clampRating(place?.rating),
    count: Number.isInteger(place?.userRatingCount) ? place.userRatingCount : null,
    mapsUrl: safeUrl(place?.googleMapsUri, GOOGLE_HOSTS),
    reviews,
  };
}

/**
 * Fetch and normalize. Never throws; returns { status } describing why nothing
 * is shown. The API key only ever travels in a request header.
 */
export async function loadGoogleReviews(env, fetchImpl = fetch) {
  const key = String(env?.GOOGLE_PLACES_API_KEY || '').trim();
  const placeId = String(env?.GOOGLE_PLACE_ID || '').trim();
  const expectedName = String(env?.GOOGLE_PLACE_EXPECTED_NAME || 'Clearview windows and trim LLC').trim();

  if (!key || !placeId) return { status: 'unconfigured', reviews: [] };
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(placeId)) return { status: 'unconfigured', reviews: [] };

  try {
    const response = await fetchImpl(`${PLACES_ENDPOINT}${encodeURIComponent(placeId)}?languageCode=en`, {
      method: 'GET',
      headers: {
        'x-goog-api-key': key,
        'x-goog-fieldmask': FIELD_MASK,
        accept: 'application/json',
      },
    });
    if (!response.ok) return { status: 'unavailable', reviews: [] };
    return normalizePlace(await response.json(), { expectedName });
  } catch {
    return { status: 'unavailable', reviews: [] };
  }
}
