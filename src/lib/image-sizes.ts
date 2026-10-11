// Picks the right source file for a photo tile, and the tile's frame.
//
// Two facts decide whether a photo looks sharp:
//
//   1. The browser chooses a file from `srcset` using the `sizes` we declare, so
//      `sizes` has to match the width the tile really renders at on each screen.
//      The values in SLOT_SIZES were measured in a real browser (2026-10-10) at
//      15 viewport widths from 320 to 1920 px; see docs/IMAGE-DELIVERY.md.
//
//   2. A tile shows its photo with `object-fit: cover`. When the photo is wider
//      than its frame, the browser scales it to the frame's HEIGHT, so the file
//      has to be wider than the tile by the same factor. A 4:3 photo in a 3:4
//      frame needs a file 1.78x the tile width; without that the browser picked
//      a file the size of the tile and stretched it by 1.75x.
//
// Pure functions with no Astro imports, so `npm run test:image-delivery` runs
// them directly.
//
// One trap, found the hard way: an imported photo is a Proxy, and reading ANY
// defined property (`width`, `height`, `format`) marks the original file as
// "referenced", so the build copies the full-size JPEG into the published site.
// Reading width and height off 50 photos put 71 MB of originals in dist/_astro.
// Astro's own code reads through `.clone`, which returns a plain copy without
// marking anything; `dimensionsOf` does the same, and every function below goes
// through it. Never read `photo.image.width` directly in a component.

/** What an imported photo (ImageMetadata) or a plain `{ width, height }` looks like. */
export type ImageLike = { width: number; height: number; clone?: { width: number; height: number } };

/** Pixel size of a photo, read without marking its original file for publishing (see above). */
export function dimensionsOf(image: ImageLike): { width: number; height: number } {
  const plain = image.clone ?? image;
  return { width: plain.width, height: plain.height };
}

/** Frame shapes a tile can use. Ratio is width / height. */
export const FRAMES = {
  portrait: 3 / 4,
  landscape: 4 / 3,
  square: 1,
} as const;

export type FrameName = keyof typeof FRAMES;

/**
 * Tile widths per layout, as `sizes` lists. Each was measured, then rounded UP to
 * the next whole pixel so a tile is never under-declared (a slightly larger file
 * costs a few kB; a smaller one shows as a soft photo).
 */
export const SLOT_SIZES = {
  /** Home work grid, gallery "large" and "square" groups: 2 columns on a phone, 3 on a desktop. */
  threeAcross: '(max-width: 560px) 45vw, (max-width: 900px) 46vw, 450px',
  /** Gallery "dense" groups: 2 columns on a phone, 4 on a desktop. */
  fourAcross: '(max-width: 560px) 45vw, (max-width: 900px) 31vw, 340px',
  /**
   * The shared `.work-grid` (auto-fill, 240px minimum): ONE full-width column up to
   * 546 px wide, which is every phone, then 2-4 columns no wider than 316 px.
   */
  autoFill: '(max-width: 546px) calc(100vw - 51px), 320px',
  /** New-construction page: one full-width column up to 999 px, then beside the copy at <= 485 px. */
  fullThenBeside: '(max-width: 999px) calc(100vw - 50px), 490px',
  /** Window-features style photos: 2 columns up to 900 px, then 4 columns no wider than 347 px. */
  twoThenFour: '(max-width: 560px) 45vw, (max-width: 900px) 46vw, 350px',
  /** A lone gallery tile: a 22rem (352 px) column, full width on the narrowest phones. */
  single: '(max-width: 403px) calc(100vw - 51px), 352px',
  /**
   * The lead photo of a photo guide (diagrams/PhotoGuide.astro): one column to 900 px, then beside
   * the copy. Measured 236-846 px wide on phones and tablets, 477-802 px above 900 px; the tile's
   * height follows the copy next to it, so this is the width only (the file is `cover`-cropped).
   */
  leadPhoto: '(max-width: 900px) 100vw, 800px',
  /**
   * A full-width guide graphic (CanvaGuideEmbed) above the 760 px phone breakpoint: the page gutter
   * is 100 px (668 px at 761, 1166 px at 1280), then the 1180 px column stops growing.
   */
  guideGraphic: '(max-width: 1280px) calc(100vw - 100px), 1180px',
} as const;

/** Candidate widths for a lead photo: 800 px at 2x needs 1600, a tall guide tile about 1550. */
export const LEAD_PHOTO_WIDTHS = [700, 1000, 1400, 1800, 2200];

/** Candidate file widths. 1200 covers a full-width phone tile at 3x (about 1000-1140 px). */
export const TILE_WIDTHS = [240, 340, 450, 680, 900, 1200];

/** Extra candidates for a photo cropped hard (see `coverScale`): its file must be about 2x the tile. */
export const CROPPED_TILE_WIDTHS = [...TILE_WIDTHS, 1600, 2000];

/** Above this `coverScale`, a photo is cropped hard enough to need CROPPED_TILE_WIDTHS. */
export const HARD_CROP = 1.25;

/** Candidate widths for a tile whose photo is cropped by `scale` (a `coverScale` result). */
export function tileWidths(scale: number): number[] {
  return scale > HARD_CROP ? CROPPED_TILE_WIDTHS : TILE_WIDTHS;
}

/** Photos that are wider than tall. */
export function isLandscape(image: ImageLike): boolean {
  const { width, height } = dimensionsOf(image);
  return width > height;
}

/**
 * Frame for a group of photos shown together. Landscape only when EVERY photo in
 * the group is landscape: a mixed row of frame shapes looks ragged, so mixed groups
 * keep the portrait frame the rest of the site uses.
 */
export function frameForGroup(photos: ReadonlyArray<{ image: ImageLike }>): FrameName {
  return photos.length > 0 && photos.every((photo) => isLandscape(photo.image)) ? 'landscape' : 'portrait';
}

/**
 * How many times wider than the tile the file must be so a `cover` crop is not
 * stretched. 1 when the photo is no wider than its frame (the tile's width then
 * decides); photo ratio / frame ratio when it is wider (its height decides).
 */
export function coverScale(source: ImageLike, frameRatio: number): number {
  const { width, height } = dimensionsOf(source);
  if (!(width > 0) || !(height > 0) || !(frameRatio > 0)) return 1;
  const scale = width / height / frameRatio;
  return scale <= 1 ? 1 : Math.ceil(scale * 100) / 100;
}

/**
 * Multiplies every slot width in a `sizes` list by `factor`. Entries are either
 * `<length>` or `(<media condition>) <length>`; the length becomes
 * `calc(<length> * factor)`. A factor of 1 returns the list unchanged.
 */
export function scaleSizes(sizes: string, factor: number): string {
  if (!(factor > 1)) return sizes;
  return splitTopLevel(sizes)
    .map((entry) => {
      const media = /^((?:\([^)]*\)\s*(?:and\s+)?)+)(.+)$/.exec(entry);
      return media ? `${media[1].trim()} calc(${media[2].trim()} * ${factor})` : `calc(${entry} * ${factor})`;
    })
    .join(', ');
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The `sizes` attribute for a tile: slot widths, scaled for the cover crop. */
export function tileSizes(sizes: string, source: ImageLike, frame: FrameName): string {
  return scaleSizes(sizes, coverScale(source, FRAMES[frame]));
}
