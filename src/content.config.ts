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
    faq: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  }),
});

const reviews = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/reviews' }),
  schema: z.object({
    quote: z.string(),
    name: z.string(),
    city: z.string(),
    source: z.string().default('Customer'),
    published: z.boolean().default(false),
  }),
});

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: ({ image }) => z.object({
    title: z.string(),
    description: z.string(),
    kicker: z.string().default('Guide'),
    topic: z.string(),
    published: z.boolean().default(true),
    updated: z.coerce.date(),
    order: z.number().default(99),
    diagram: z.enum(['insert-vs-full-frame', 'flashing-order', 'glass-anatomy', 'signs-checklist']).optional(),
    secondaryDiagram: z.enum(['flashing-order', 'cost-build-up']).optional(),
    heroImage: image().optional(),
    heroImageAlt: z.string().optional(),
    heroImageCredit: z.string().optional(),
    heroImageFocus: z.string().optional(),
    faq: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  }),
});

const legal = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/legal' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    summary: z.string().optional(),
    updated: z.coerce.date(),
    order: z.number().default(99),
    published: z.boolean().default(true),
  }),
});

export const collections = { cities, reviews, guides, legal };
