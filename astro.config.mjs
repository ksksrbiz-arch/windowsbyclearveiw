// @ts-check
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const root = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(root, 'marks_work_photos');
const destDir = join(root, 'public', 'work');

/** @type {Record<string, string>} */
const copies = {
  'e48a41d5-446c-4214-b86c-f2cb839114dd.jpe': 'stone-craftsman.jpg',
  'ef3c58d2-5fdf-4320-aed5-ef337fb1c9cd.jpe': 'vaulted-grids.jpg',
  'e0603003-78f6-4fc6-a60d-515fa1c1c028.jpe': 'tan-two-story.jpg',
  '516123f4-e930-4db1-9fce-0ba56de74476.jpe': 'slider-shutters.jpg',
  '851996dd-09fb-4465-92ec-35eed40a23ad.jpe': 'blue-ladder.jpg',
  'b54f6e0b-d6a2-48e6-a961-86ef8831628a.jpe': 'new-unit-interior.jpg',
  'dc54b60d-7072-4960-9892-ed59300a35e6.jpe': 'bedroom-view.jpg',
  'b4b5efd0-f018-4532-8d62-84e6431aacde.jpe': 'two-story-white.jpg',
  '3c597480-2ef4-4bdf-9ccd-560fec86120d.jpe': 'ranch-slider.jpg',
  'ad122a25-d3fd-431a-9267-880bf654b564.jpe': 'ranch-stairs.jpg',
  'a8803cf8-08a7-472c-b997-4d72a6938925.jpe': 'tan-upper-slider.jpg',
  '501a9a9c-2808-4b37-b382-d55a9374727d.jpe': 'blue-slider.jpg',
  'cf8e95e0-40ae-4461-86fb-8494ac5dde64.jpe': 'blue-hung-ladder.jpg',
  'a2b50b7d-e828-4a98-8a49-0343fd72de59.jpe': 'blue-hung.jpg',
  '43258b26-4aed-4efb-b08f-05db29ca90d0.jpe': 'cream-side.jpg',
  '3a0d9a8a-cf4f-49e9-8de3-0a71c5e593ee.jpe': 'cream-entry.jpg',
  'e137e13b-d8ff-4bf6-9215-4e1963ea2d79.jpe': 'pink-bungalow.jpg',
  'acc1a295-5e14-44bb-939e-7a63fcbf29e0.jpe': 'pink-gable-ladder.jpg',
  'ff39343e-fe8d-4fcf-818e-959e68f5adc4.jpe': 'pink-gable.jpg',
};

if (existsSync(sourceDir)) {
  mkdirSync(destDir, { recursive: true });
  for (const [from, to] of Object.entries(copies)) {
    const src = join(sourceDir, from);
    if (existsSync(src)) copyFileSync(src, join(destDir, to));
  }
}

export default defineConfig({
  site: 'https://windowsbyclearveiw.com',
  integrations: [sitemap()],
  trailingSlash: 'never',
});
