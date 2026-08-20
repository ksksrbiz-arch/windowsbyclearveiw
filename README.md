# Clearveiw Windows

Marketing site for **Clearveiw Windows, LLC** — replacement and new-construction
window installation in Vancouver, WA and the rest of Clark County.

- Domain: [windowsbyclearveiw.com](https://windowsbyclearveiw.com)
- Stack: [Astro](https://astro.build) (static, no adapter)
- Deploy: Cloudflare Pages from this GitHub repo

## Before this counts as live advertising

- [ ] **L&I contractor registration number.** Set `lniNumber` in `src/data/site.ts`.
      Washington requires a registered contractor's number in advertising, and a
      website is advertising. The build prints a warning while it is empty, and the
      footer says the number is pending rather than inventing one.
- [ ] **`RESEND_API_KEY`** set in Cloudflare Pages → Settings → Environment variables
      (Production, and Preview if you want to test there). Without it the estimate
      form answers "Mail is not configured yet" and no lead reaches Mark.
- [ ] **Reviews.** `/reviews` is deliberately empty. Only add entries with
      `published: true` for quotes from real customers who agreed to be quoted.

## Local development

Requires Node 22.12+.

```bash
npm install
npm run dev
```

Build check:

```bash
npm run build
npm run preview
```

## Cloudflare Pages

1. Workers & Pages → Create → Pages → Import this repository.
2. Production branch: `main`
3. Build command: `npm run build`
4. Build output directory: `dist`
5. Attach `windowsbyclearveiw.com` after the first deploy.

No Cloudflare adapter is required while the site stays static. The estimate form
runs as a Pages Function from `functions/api/estimate.js`.

## Where to edit content

| What | File |
| --- | --- |
| Phone, email, L&I, service area | `src/data/site.ts` |
| Job photos, captions, alt text | `src/data/work.ts` + `src/assets/work/` |
| City pages | `src/content/cities/` |
| Reviews | `src/content/reviews/` |
| Guides | `src/content/guides/` |
| Homepage video | `public/video/hero.mp4` |

### Adding a photo

1. Drop the file in `src/assets/work/` with a descriptive name (`green-gable.jpg`).
2. Import it in `src/data/work.ts` and add an entry with real alt text.
3. `featured: true` puts it in the six-tile block on the homepage.

Astro resizes these at build time and emits WebP, so commit the original — do not
pre-shrink it. Photos are *not* in `public/`; anything there ships unprocessed.

### Adding a service area

Add a markdown file to `src/content/cities/`, then add the city to `nearby` in
`src/data/site.ts` so it shows up in the schema and the About page.

## The estimate form

`POST /api/estimate` → Resend, using two published templates:

- Lead to Mark — [estimate-request](https://resend.com/templates/f8b73ea1-867e-48b8-8ccf-926b1a825913)
- Receipt to the customer — [estimate-received](https://resend.com/templates/68555c62-cbc3-4061-8dfe-ea1b02a59c75)

Environment variables it reads:

| Variable | Required | Default |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | — |
| `NOTIFY_EMAIL` | no | `mark.rotar1000@gmail.com` |
| `RESEND_FROM` | no | `Clearveiw Windows <estimates@windowsbyclearveiw.com>` |

With JavaScript the page swaps in a confirmation panel. Without it, the function
redirects to `/estimate/sent` or `/estimate/problem`, so the form still works.

## Notes

The legal / domain spelling **Clearveiw** is used throughout. Public copy can still
say "Clearview" if you decide that is the brand.
