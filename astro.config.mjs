// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { site } from './src/data/site.ts';

// Washington requires the contractor registration number in advertising, and a
// website counts. Shout in the build log until it is filled in.
if (!site.lniNumber) {
  console.warn(
    '\n[clearveiw] WARNING: site.lniNumber is empty. Add Mark\'s L&I contractor ' +
      'registration number in src/data/site.ts before advertising this site.\n',
  );
}

export default defineConfig({
  site: 'https://windowsbyclearveiw.com',
  integrations: [
    sitemap({
      // Outcome pages for the estimate form — no search value, and /problem
      // reads like a broken page if someone lands on it cold.
      filter: (page) =>
        !page.includes('/estimate/sent') && !page.includes('/estimate/problem'),
    }),
  ],
  trailingSlash: 'never',
});
