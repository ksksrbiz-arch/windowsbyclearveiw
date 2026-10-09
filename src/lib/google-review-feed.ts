export type GoogleReviewFeed = {
  status: string;
  rating?: number | null;
  count?: number | null;
  reviews?: { rating: number; text: string; author: string; authorUrl: string; when: string }[];
};

let pending: Promise<GoogleReviewFeed | null> | undefined;
let requestedAt = 0;

// Share one request across badges and review cards, including client navigation.
export function getGoogleReviewFeed() {
  if (!pending || Date.now() - requestedAt > 300_000) {
    requestedAt = Date.now();
    pending = fetch('/api/google-reviews', { headers: { accept: 'application/json' } })
      .then(response => response.ok ? response.json() : null)
      .catch(() => null);
  }
  return pending;
}
