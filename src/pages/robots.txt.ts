import type { APIRoute } from 'astro';
import { site } from '../data/site';

export const GET: APIRoute = () => {
  // "/internal/" (with the trailing slash) blocks everything *under* the
  // section but not its own index route, whose URL is exactly "/internal" --
  // the same gap that let it leak into the sitemap (see astro.config.mjs).
  // Dropping the slash makes this a prefix match that covers both.
  const body = `User-agent: *
Allow: /
Disallow: /internal
Disallow: /api/

Sitemap: ${site.url}/sitemap-index.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
