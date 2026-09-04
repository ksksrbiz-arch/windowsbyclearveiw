// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/data/site.ts';

// Washington requires the contractor registration number in advertising, and a
// website counts. Warn by default so the site stays deployable while it is still
// being built out; set REQUIRE_LNI=1 in the Cloudflare Pages production
// environment to turn that into a hard stop once the number is in hand.
if (!site.lniNumber) {
  const message =
    "site.lniNumber is empty. Add Mark's L&I contractor registration number in " +
    'src/data/site.ts before advertising this site.';
  if (process.env.REQUIRE_LNI === '1') {
    throw new Error(`[clearview] ${message}`);
  }
  console.warn(`\n[clearview] WARNING: ${message}\n`);
}

export default defineConfig({
  site: 'https://windowsbyclearview.com',
  integrations: [
    sitemap({
      // Outcome pages for the estimate form — no search value, and /problem
      // reads like a broken page if someone lands on it cold.
      filter: (page) =>
        !page.includes('/estimate/sent') &&
        !page.includes('/estimate/problem') &&
        !page.includes('/internal/'),
    }),
  ],
  trailingSlash: 'never',
  // Astro's default 'directory' format writes every route as
  // `page/index.html`, which doesn't match `trailingSlash: 'never'` above —
  // Cloudflare Pages' static server then 308-redirects a bare `/estimate`
  // request to `/estimate/` on first (non-SPA) load, because that's the only
  // path with a matching file. 'file' format writes `page.html` instead, so
  // the URL Astro generates and the file Pages finds are the same request,
  // no redirect needed.
  build: {
    format: 'file',
  },
});
