# Google operations connections

Authenticated Command Center > Tools > Google tools. These are user-requested operations, not automated customer workflows. D1 remains business truth; external responses are proposals or reports. Account configuration alone is not evidence of working access.

## Input

Server-only credentials described in `internal/README.md`; explicit operator requests. Search/report queries contain no visitor identity. Maps requests transmit entered addresses or coordinates. Document requests transmit one explicitly selected file. Calendar creation transmits the reviewed title and times.

## Process

- `functions/internal/_middleware.js` authenticates every page/API request. Writes additionally require an exact same-origin Origin header.
- `functions/internal/_lib/google-auth.mjs` signs scoped service-account assertions or refreshes the owner OAuth token. Tokens, keys and provider error bodies never reach the browser.
- `functions/internal/_lib/google-operations.mjs` validates inputs and selects fixed Google endpoints. There are no operator-controlled provider URLs or scopes.
- `functions/internal/api/google-tools.js` enforces shared daily D1 limits: 10 receipt reads, 10 label reads, 10 calendar-create attempts, and 50 attempts per other action. Failed provider calls consume attempts. Missing configuration never calls Google. Missing D1 fails closed.
- Maximum one document, first page only for Document AI, 2 MiB decoded, supported magic bytes, 3 MB streamed request cap, 15-second timeout per upstream request, at most two upstream calls normally (token plus operation), three for a calendar conflict check. No retries or background extraction.
- Search returns top 25 query/page combinations from the last available 28 days, not complete totals. Business metrics are button clicks/impressions, not confirmed calls. Reviews return at most 50, with a more-results indicator. Calendar returns up to 50 events across seven days.
- Routes fixes origin/destination and can reorder middle stops; appointment constraints are NOT modeled. This is Routes API, not the fleet Route Optimization API. Weather is planning information, never an automatic installation decision.
- Receipt extraction is an allowlisted proposal of at most 20 fields. Label OCR is capped at 20,000 characters. Neither writes job facts or expenses. Human-reviewed expense entry uses exact integer USD cents and an optional existing job reference. It records cost, not payment or reconciliation.
- Calendar creation requires reviewed input; deterministic event IDs prevent a retry from adding duplicates, and conflicting IDs are checked against the original event. No attendees, invitations, job rescheduling or customer messages.

## Output

Private no-store responses; bounded reports and clearly attributed Google Maps results. Documents and provider results are not cached or persisted. D1 stores only daily counts and manually confirmed expense values. Never commit customer files, keys or OAuth credentials.

## Stop conditions

Invalid input, unauthenticated/cross-origin request, missing connection/database, exhausted limit, failed provider call, or a conflicting saved request ID. No fabricated substitute results. Show account setup or retry status. Obtain explicit confirmation when creating persistent credentials, granting owner access, or accepting new terms.

## Completion

Run `npm run test:google-tools`, full `npm run test:all`, and `npm run build`; verify the Pages deployment, authenticated tools at desktop/phone width, and one synthetic live read per enabled service. Track missing credentials/API approval as VERIFY, never as connected. Run `npm run check:pwa-live` after deployment.

## Primary API references

- [Search Console query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- [Business Profile access prerequisites](https://developers.google.com/my-business/content/prereqs)
- [Business Profile metrics](https://developers.google.com/my-business/reference/performance/rest/v1/locations/fetchMultiDailyMetricsTimeSeries)
- [Business Profile reviews](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list)
- [Address Validation](https://developers.google.com/maps/documentation/address-validation/requests-validate-address)
- [Routes waypoint order](https://developers.google.com/maps/documentation/routes/opt-way)
- [Weather forecast](https://developers.google.com/maps/documentation/weather/daily-forecast), [attribution](https://developers.google.com/maps/documentation/weather/policies)
- [Document AI processors](https://docs.cloud.google.com/document-ai/docs/processors-list)
- [Vision OCR](https://docs.cloud.google.com/vision/docs/ocr)
- [Calendar insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
