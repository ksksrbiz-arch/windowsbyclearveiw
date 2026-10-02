import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

// Page-hero photos are CSS backgrounds under a 58-88% black gradient, so detail
// beyond this is invisible while the bytes are not: the old 2400px / q76 render
// shipped ~800 kB per hero. 1600px covers a 1440px viewport at 1x; q60 is
// imperceptible under the overlay.
export const HERO_BG_WIDTH = 1600;
export const HERO_BG_QUALITY = 60;

export function getHeroBg(src: ImageMetadata) {
  return getImage({ src, width: HERO_BG_WIDTH, format: 'webp', quality: HERO_BG_QUALITY });
}
