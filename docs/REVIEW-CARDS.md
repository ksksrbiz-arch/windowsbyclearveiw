# Review cards and automatic updates

Hali Kimball's exact five-star quote comes from the screenshot supplied by Keith
on 2026-10-06. `src/content/reviews/hali-kimball.md` supplies the card, including
Google attribution and a link to the business profile. City and posting date
are intentionally absent because the screenshot does not establish either.
`site.googleReviews` records the screenshot's 5.0 average from two reviews.

The existing `/api/google-reviews` endpoint already supports automatic updates
without rebuilding the site. The production endpoint returned
`{"status":"unconfigured","reviews":[]}` during this change. To enable it, set
the server-side `GOOGLE_PLACES_API_KEY` secret and verified `GOOGLE_PLACE_ID`
in Cloudflare Pages, then redeploy. See `internal/README.md` for configuration
and the phone-matching Place ID helper. Never put the key in browser code.
Default refresh is on the next visit after the six-hour edge cache expires.

Places supplies up to five selected reviews; it does not guarantee every new
review will be returned. For a complete feed, Google's Business Profile API
requires approved API access and business-owner OAuth authorization:
https://developers.google.com/my-business/content/prereqs
https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews/list

Curated cards render without JavaScript and survive feed failures. A live review
hides only a static card with the same normalized author and quote, leaving
other curated cards intact. Review text remains plain text, with accessible
star ratings and no self-serving review structured data.

### 2026-10-06 visual refinement

Replaced the initial outline card with a full-width teal gradient spotlight,
gold stars and initials avatar, larger quote, Google source badge and separate
author footer. Shared review-cards.css applies to both curated and live cards.
Checked desktop and 375px layout without horizontal overflow; review tests and
production build passed. Updated the same PR branch; production is still pending.