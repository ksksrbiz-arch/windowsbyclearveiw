# Clearveiw Windows

Marketing site for **Clearveiw Windows, LLC** — window installation in Washington.

- Domain: [windowsbyclearveiw.com](https://windowsbyclearveiw.com)
- Stack: [Astro](https://astro.build) (static)
- Deploy: Cloudflare Pages from this GitHub repo

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

No Cloudflare adapter is required while the site stays static.

## Where to edit content

| What | File |
| --- | --- |
| Phone, email, L&I, NAP | `src/data/site.ts` |
| City pages | `src/content/cities/` |
| Gallery jobs | `src/content/jobs/` |
| Reviews | `src/content/reviews/` |

City, job, and review entries are placeholders. Replace them before treating the site as live advertising. Washington requires the contractor L&I number on the website.

## Notes

The legal / domain spelling **Clearveiw** is used throughout. Public copy can still say “Clearview” if you decide that is the brand.
