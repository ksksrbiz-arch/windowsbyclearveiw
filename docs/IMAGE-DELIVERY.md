# Image delivery

How a photo gets from `src/assets/` to a sharp, whole picture on the customer's screen, what was wrong, how it was measured, and how to keep it right. Measured 2026-10-10 in a real browser (Chromium via Playwright) against the built site.

## What was wrong

Every `<img>` was measured at three screens: a 1440 px desktop at 1x, the same width at 2x (a retina laptop) and a 390 px phone at 3x. "Sharpness" below is the width of the file the browser chose divided by the pixels the tile needs; 1.0 is exactly enough, under 0.9 reads soft.

1. **Landscape photos in portrait tiles were stretched.** A tile shows its photo with `object-fit: cover`. A 4:3 photo in a 3:4 tile is scaled to the tile's *height*, so the file must be about 1.77x the tile's width. The code asked for a tile-width file and the browser stretched it up to 1.75x. The crop also cut half the building off.
2. **`sizes` described a layout the page did not have.** Tiles declared `45vw` (two columns). The shared `.work-grid` (`repeat(auto-fill, minmax(240px, 1fr))`) is **one full-width column up to about 546 px**, so on every phone a tile rendered at 87vw and got a file for 45vw (0.67x).
3. **The home hero's final photo was one 1200 px file** on screens that need 2000 to 2900 px (0.42 to 0.63x).
4. **Lead photos and guide graphics stopped at 1400 px** and a 2x laptop wants 1600 to 2360.

## Result (same 12 key pages, before and after)

| Screen | Soft (<0.9x) before | after | Very soft (<0.6x) before | after |
|---|---|---|---|---|
| Desktop 1x | 14 | **0** | 8 | 0 |
| Laptop 2x | 18 | **2** | 9 | 0 |
| Phone 3x | 41 | **0** | 6 | 0 |

Whole site (37 pages, 141 photos) after: desktop 0, phone 0, laptop 2x three soft, all **source-limited or capped, none fixable by the pipeline**:

| Photo | Sharpness at 2x | Why |
|---|---|---|
| `/guides/fogged-windows` double-pane graphic | 0.85 | Canva export is 2000 px wide; shown 1180 px wide |
| `/window-features` vinyl-fiberglass graphic | 0.89 | Canva export is 2200 px wide |
| Home hero (final photo) | 0.89 | Capped at 2560 px on purpose (bytes) |

Two photos are over-declared (1.9x to 2.0x, 96 kB each): the cost guide's lead photo and the vinyl-fiberglass graphic on `/replacement`, which sit in narrower columns than the preset describes. Harmless; not worth a per-page preset.

**The price of sharp: phones download more.** Sharper files are bigger. Audited key pages with the whole page scrolled: phone 6.6 MB to 9.0 MB (`/process` 0.8 to 1.8 MB, `/` 0.6 to 0.9 MB), desktop and laptop about +3%. Lazy loading means a visitor pays only for what they scroll. If phone weight becomes a problem, the levers are WebP quality (WorkCard) and the top of `TILE_WIDTHS`; re-run the audit after changing either.

## The rules

1. **`sizes` must match the width the tile really renders at.** The browser picks a `srcset` candidate from `sizes` before layout. Use a preset from `SLOT_SIZES` in `src/lib/image-sizes.ts`; never type a `sizes` string into a page. `npm run test:image-delivery` fails a `<WorkCard>` that does not.
2. **A cropped photo needs a wider file.** `cover` needs `max(tileWidth, tileHeight x photoRatio) x DPR` pixels. `coverScale(photo, frameRatio)` returns the multiplier; `WorkCard` applies it to `sizes` and adds 1600/2000 px candidates when the crop is hard (`> HARD_CROP`).
3. **Pick the frame to fit the photos.** `WorkCard` takes `frame="portrait" | "landscape" | "square"`. A group of all-landscape photos (siding, new construction) uses `landscape`; interiors use `square`; mixed groups keep `portrait` so the row is not ragged. `frameForGroup(photos)` decides. The CSS aspect ratios in `WorkCard.astro` mirror `FRAMES` in `image-sizes.ts`; change both together.
4. **Never read `photo.image.width` / `.height` / `.format` in a component.** An imported photo is a Proxy; reading a defined property marks the original as referenced and the build copies the full-size JPEG into `dist/_astro` (this once put **71 MB** of originals in the published site). Use `dimensionsOf(photo.image)` or `coverScale(...)`; both read through `.clone`, which Astro itself uses and which marks nothing. The test checks the source for direct reads and checks `dist/_astro` for orphaned originals.

## Measured slot widths (`SLOT_SIZES`)

Widths of the rendered `<img>` at 15 viewports from 320 to 1920 px, rounded **up** to a whole pixel (a slightly big file costs a few kB; a small one looks soft).

| Preset | Where | Measured | Declared |
|---|---|---|---|
| `threeAcross` | Home grid, gallery large/square groups | 2 columns to 900 px, 3 above; max 450 px | `(max-width: 560px) 45vw, (max-width: 900px) 46vw, 450px` |
| `fourAcross` | Gallery dense groups | 2 cols to 560, 3 to 900, 4 above; max 340 px | `(max-width: 560px) 45vw, (max-width: 900px) 31vw, 340px` |
| `autoFill` | Shared `.work-grid` (process, siding, replacement, sliding doors, area pages) | one column = `100vw - 51px` to 546 px; then 2-4 columns, max 316 px | `(max-width: 546px) calc(100vw - 51px), 320px` |
| `fullThenBeside` | New-construction completed work | one column to 999 px (`100vw - 50px`), then beside copy, max 485 px | `(max-width: 999px) calc(100vw - 50px), 490px` |
| `twoThenFour` | Window-features style photos | 2 columns to 900 px, then 4 columns, max 347 px | `(max-width: 560px) 45vw, (max-width: 900px) 46vw, 350px` |
| `single` | A lone gallery tile (22 rem column) | `100vw - 51px` on the narrowest phones, else 352 px | `(max-width: 403px) calc(100vw - 51px), 352px` |
| `leadPhoto` | Photo-guide lead picture (new construction + four guides) | 236-846 px to 900 px; 477-802 px above | `(max-width: 900px) 100vw, 800px` |
| `guideGraphic` | Double-pane Canva graphic above 760 px | `100vw - 100px` (668 at 761, 1166 at 1280), then 1180 px | `(max-width: 1280px) calc(100vw - 100px), 1180px` |

Other deliberate choices:

- **Home hero** (`VideoHero.astro`): the static photo the hero settles on is a tall portrait filling a wide stage, so it is offered at 828/1200/1600/2000/2560 px, `sizes="(max-width: 640px) 160vw, 100vw"` (on a phone the stage is taller than wide), WebP q66, `fetchpriority="low"` so it never competes with the video and poster. The poster keeps 1200 px q70.
- **Home service tiles** use `coverScale(photo, 0.85)` (the narrower of the two frame shapes) and widths up to 1600.
- **Guide hero photos** (`guides/[slug].astro`): 480/760/1140/1664 px, `(max-width: 800px) 100vw, 832px`.
- **Page-hero CSS backgrounds** (`lib/hero-bg.ts`) stay 1600 px q60: they sit under a 58-88% black wash, so more detail is invisible and the bytes are not.

## Adding or replacing a photo

1. Put the original in `src/assets/work/`, as large as the camera gave you (most are 3000-4000 px on the long edge; `docs/REPO-PHOTO-AUDIT-2026-10-07.md` lists the few that were upscaled). A small original caps how sharp its tile can be, whatever `srcset` offers.
2. Add it to `src/data/work.ts`. Render it through `<WorkCard>`; choose the `sizes` preset for its grid and let `frameForGroup` choose the frame.
3. `npm run build && npm run test:image-delivery`. For a layout the presets do not cover, measure the slot at several viewport widths, add a preset to `SLOT_SIZES` **with the measurement in its comment and a row in the table above**, and extend the test.

## Checking it in a browser

`npm run test:image-delivery` (in CI, after the build) guards the rules above: cover maths, frames, preset shapes, the Proxy trap, no orphaned originals, alt text on every image, srcset and sizes on every tile, landscape frames where they belong, large candidates for hard crops, the hero's 2560 px candidate, lead photos and guide graphics past 1600 px. The cover maths, the Proxy guard, the orphan check and the lead-photo check were each mutation-tested: the rule was deliberately broken and the test confirmed to fail.

`scripts/audit-image-delivery.mjs` is the tool that found the problems. It needs a browser, which this repo does not install, so it is **not in CI**:

```
npm i --no-save playwright          # or CHROMIUM_PATH=/path/to/chrome if you have a browser
npm run build && npx astro preview --port 4330 &
node scripts/audit-image-delivery.mjs                     # 12 key pages
node scripts/audit-image-delivery.mjs --all --json out.json   # every built page, with detail
```

It prints, per screen, photos audited, how many are soft (<0.9x) and very soft (<0.6x), how many are over-sized (>1.8x, wasted bytes), and kilobytes transferred, then lists the worst offenders. Run it after any change to a layout, a `sizes` preset or a frame.

## Not done (options)

- **Enlarge on click.** Gallery tiles cannot be opened bigger; the older 50 photos have no lightbox.
- **Hero photo choice.** The home hero is a portrait photo cropped into a wide banner. A landscape-native photo would fit better.
- **Home "featured work" grid** mixes landscape photos into portrait frames (heavily cropped, though sharp).
- **Phone video-hero reveal** crops the logo wordmark on a phone (existing deliberate crop in `global.css`).
