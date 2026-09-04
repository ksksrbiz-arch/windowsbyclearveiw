import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const cities = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/cities' }),
  schema: z.object({
    name: z.string(),
    region: z.string().default('Washington'),
    title: z.string(),
    description: z.string(),
    published: z.boolean().default(true),
  }),
});

const reviews = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/reviews' }),
  schema: z.object({
    quote: z.string(),
    name: z.string(),
    city: z.string(),
    source: z.string().default('Customer'),
    /**
     * Off by default on purpose. Only real quotes Mark has permission to
     * republish should ever reach the page — inventing testimonials is both a
     * trust problem and an FTC one.
     */
    published: z.boolean().default(false),
  }),
});

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      kicker: z.string().default('Guide'),
      topic: z.string(),
      published: z.boolean().default(true),
      updated: z.coerce.date(),
      order: z.number().default(99),
      /**
       * Optional diagram rendered above the body. Keyed rather than hardcoded in
       * the template so a new guide can claim one from its own frontmatter.
       */
      diagram: z.enum(['insert-vs-full-frame', 'flashing-order', 'glass-anatomy', 'signs-checklist']).optional(),
      /**
       * A second, deeper diagram rendered after the article body, before the
       * FAQ -- for a guide that already uses the top slot for a heroImage
       * (like the cost guide) or wants a second, more detailed diagram after
       * the reader has the context to use it (like flashing order after the
       * full-frame-vs-insert explanation).
       */
      secondaryDiagram: z.enum(['flashing-order', 'cost-build-up']).optional(),
      /**
       * Optional topical stock photo for the same slot the diagram uses —
       * never both on one guide. Never a real Clearview job photo (those live
       * in src/assets/work and only appear in the Gallery and homepage, where
       * the "after" claim is true). Sourced under a license that permits
       * commercial use with no attribution required; heroImageCredit records
       * source + license for the record even though display isn't required.
       */
      heroImage: image().optional(),
      heroImageAlt: z.string().optional(),
      heroImageCredit: z.string().optional(),
      /** CSS object-position for the hero crop, e.g. "50% 68%". Defaults to center. */
      heroImageFocus: z.string().optional(),
      faq: z
        .array(
          z.object({
            question: z.string(),
            answer: z.string(),
          }),
        )
        .default([]),
    }),
});

const legal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    /** Shown on the page and used for the "last updated" line. */
    updated: z.coerce.date(),
    order: z.number().default(99),
    /** Appears above the body, before the legal text proper. */
    summary: z.string(),
  }),
});

export const collections = { cities, reviews, guides, legal };
