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
  schema: z.object({
    title: z.string(),
    description: z.string(),
    kicker: z.string().default('Guide'),
    topic: z.string(),
    published: z.boolean().default(true),
    updated: z.coerce.date(),
    order: z.number().default(99),
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

export const collections = { cities, reviews, guides };
