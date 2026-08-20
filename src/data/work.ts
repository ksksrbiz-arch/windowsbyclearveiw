import type { ImageMetadata } from 'astro';

export type WorkKind = 'after' | 'interior' | 'process' | 'new construction';

export type WorkPhoto = {
  id: string;
  image: ImageMetadata;
  alt: string;
  caption: string;
  kind: WorkKind;
  featured: boolean;
  order: number;
};

// Mark's photos live in src/assets/work so Astro can resize them and emit
// AVIF/WebP. Importing them here (not a glob) keeps the alt text next to the
// file it describes and fails the build if a photo goes missing.
import bedroomView from '../assets/work/bedroom-view.jpg';
import blueGableArch from '../assets/work/blue-gable-arch.jpg';
import blueHung from '../assets/work/blue-hung.jpg';
import blueHungLadder from '../assets/work/blue-hung-ladder.jpg';
import blueLadder from '../assets/work/blue-ladder.jpg';
import bluePairInstallday from '../assets/work/blue-pair-installday.jpg';
import blueSlider from '../assets/work/blue-slider.jpg';
import creamEntry from '../assets/work/cream-entry.jpg';
import creamSide from '../assets/work/cream-side.jpg';
import dormerSet from '../assets/work/dormer-set.jpg';
import gableArchLadders from '../assets/work/gable-arch-ladders.jpg';
import graySideSlider from '../assets/work/gray-side-slider.jpg';
import greenCraftsmanUpper from '../assets/work/green-craftsman-upper.jpg';
import newConstructionSheathed from '../assets/work/new-construction-sheathed.jpg';
import newUnitInterior from '../assets/work/new-unit-interior.jpg';
import pinkBungalow from '../assets/work/pink-bungalow.jpg';
import pinkGable from '../assets/work/pink-gable.jpg';
import pinkGableLadder from '../assets/work/pink-gable-ladder.jpg';
import ranchSlider from '../assets/work/ranch-slider.jpg';
import ranchStairs from '../assets/work/ranch-stairs.jpg';
import sliderShutters from '../assets/work/slider-shutters.jpg';
import stoneCraftsman from '../assets/work/stone-craftsman.jpg';
import tanTwoStory from '../assets/work/tan-two-story.jpg';
import tanUpperSlider from '../assets/work/tan-upper-slider.jpg';
import twoStoryWhite from '../assets/work/two-story-white.jpg';
import vaultedGrids from '../assets/work/vaulted-grids.jpg';

export const workPhotos: WorkPhoto[] = [
  {
    id: 'blue-gable-arch',
    image: blueGableArch,
    alt: 'Arched transom over a three-wide window in the gable of a dark blue house above brick',
    caption: 'Arched transom in the gable',
    kind: 'after',
    featured: true,
    order: 1,
  },
  {
    id: 'green-craftsman-upper',
    image: greenCraftsmanUpper,
    alt: 'New upper-story picture window on a green craftsman two-story with a covered porch',
    caption: 'Upper picture window, craftsman elevation',
    kind: 'after',
    featured: true,
    order: 2,
  },
  {
    id: 'stone-craftsman',
    image: stoneCraftsman,
    alt: 'Two-story Washington house with stone veneer and cream vinyl windows after replacement',
    caption: 'Cream vinyl on a stone-and-siding elevation',
    kind: 'after',
    featured: true,
    order: 3,
  },
  {
    id: 'vaulted-grids',
    image: vaultedGrids,
    alt: 'Pair of white double-hung windows with grids in a vaulted bedroom',
    caption: 'Double-hungs with grids, finished interior',
    kind: 'interior',
    featured: true,
    order: 4,
  },
  {
    id: 'gray-side-slider',
    image: graySideSlider,
    alt: 'Side elevation of a gray lap-siding house with a new white slider and upper windows',
    caption: 'Full side elevation, after',
    kind: 'after',
    featured: true,
    order: 5,
  },
  {
    id: 'new-construction-sheathed',
    image: newConstructionSheathed,
    alt: 'Windows set and flashed in a sheathed two-story new build, taped seams, before siding',
    caption: 'Set and flashed, ready for siding',
    kind: 'new construction',
    featured: true,
    order: 6,
  },
  {
    id: 'blue-pair-installday',
    image: bluePairInstallday,
    alt: 'Pair of new white double-hung windows on blue siding with a caulk gun on the roof below',
    caption: 'Install day — sealing the pair',
    kind: 'process',
    featured: false,
    order: 7,
  },
  {
    id: 'tan-two-story',
    image: tanTwoStory,
    alt: 'Tan two-story house with new white sliders above a garage',
    caption: 'Sliders on a two-story elevation',
    kind: 'after',
    featured: false,
    order: 8,
  },
  {
    id: 'gable-arch-ladders',
    image: gableArchLadders,
    alt: 'Two ladders set against a cream gable with an arched transom window mid-replacement',
    caption: 'Ladders up to the gable',
    kind: 'process',
    featured: false,
    order: 9,
  },
  {
    id: 'slider-shutters',
    image: sliderShutters,
    alt: 'White slider window with shutters above a porch',
    caption: 'Slider and shutters over the porch',
    kind: 'after',
    featured: false,
    order: 10,
  },
  {
    id: 'blue-ladder',
    image: blueLadder,
    alt: 'Installer on a ladder setting a window on a dark blue house',
    caption: 'On the ladder, mid-install',
    kind: 'process',
    featured: false,
    order: 11,
  },
  {
    id: 'new-unit-interior',
    image: newUnitInterior,
    alt: 'New white double-hung set into existing wood trim, seen from inside the room',
    caption: 'New unit in the existing opening',
    kind: 'interior',
    featured: false,
    order: 12,
  },
  {
    id: 'dormer-set',
    image: dormerSet,
    alt: 'New windows set in a dormer and upper wall on a gray two-story',
    caption: 'Dormer and upper wall, set',
    kind: 'after',
    featured: false,
    order: 13,
  },
  {
    id: 'bedroom-view',
    image: bedroomView,
    alt: 'White double-hung window looking out over neighboring Washington rooftops',
    caption: 'Clear view from an upstairs room',
    kind: 'interior',
    featured: false,
    order: 14,
  },
  {
    id: 'two-story-white',
    image: twoStoryWhite,
    alt: 'Stacked white vinyl windows on a two-story light siding house',
    caption: 'Stacked openings, one job',
    kind: 'after',
    featured: false,
    order: 15,
  },
  {
    id: 'ranch-slider',
    image: ranchSlider,
    alt: 'Wide white slider on a single-story ranch',
    caption: 'Ranch slider, after',
    kind: 'after',
    featured: false,
    order: 16,
  },
  {
    id: 'ranch-stairs',
    image: ranchStairs,
    alt: 'Slider window on a white ranch seen from a stair landing',
    caption: 'Same house, from the stairs',
    kind: 'after',
    featured: false,
    order: 17,
  },
  {
    id: 'tan-upper-slider',
    image: tanUpperSlider,
    alt: 'Close view of an upper-story white slider on tan vertical siding',
    caption: 'Upper slider, tight trim',
    kind: 'after',
    featured: false,
    order: 18,
  },
  {
    id: 'blue-slider',
    image: blueSlider,
    alt: 'White slider on a dark blue house beside a wood deck',
    caption: 'Blue house slider',
    kind: 'after',
    featured: false,
    order: 19,
  },
  {
    id: 'blue-hung-ladder',
    image: blueHungLadder,
    alt: 'Single-hung window on a blue house with a ladder still in place',
    caption: 'Single-hung, just set',
    kind: 'process',
    featured: false,
    order: 20,
  },
  {
    id: 'blue-hung',
    image: blueHung,
    alt: 'Finished single-hung window on dark blue siding',
    caption: 'Finished hung on the blue house',
    kind: 'after',
    featured: false,
    order: 21,
  },
  {
    id: 'cream-side',
    image: creamSide,
    alt: 'Cream-sided house with new windows and a crew member working at the door',
    caption: 'Side elevation during the job',
    kind: 'process',
    featured: false,
    order: 22,
  },
  {
    id: 'cream-entry',
    image: creamEntry,
    alt: 'Installer at the door of a cream house with new windows above',
    caption: 'Install day at the entry',
    kind: 'process',
    featured: false,
    order: 23,
  },
  {
    id: 'pink-bungalow',
    image: pinkBungalow,
    alt: 'Pink bungalow with new white double-hung windows after replacement',
    caption: 'Pink bungalow, after',
    kind: 'after',
    featured: false,
    order: 24,
  },
  {
    id: 'pink-gable-ladder',
    image: pinkGableLadder,
    alt: 'Ladder up to a new gable window on a pink shake house',
    caption: 'Gable opening from the ladder',
    kind: 'process',
    featured: false,
    order: 25,
  },
  {
    id: 'pink-gable',
    image: pinkGable,
    alt: 'White double-hung in the gable of a pink shake house',
    caption: 'Gable window, set',
    kind: 'after',
    featured: false,
    order: 26,
  },
];

const byOrder = (a: WorkPhoto, b: WorkPhoto) => a.order - b.order;

export const featuredWork = workPhotos.filter((photo) => photo.featured).sort(byOrder);

export const processWork = workPhotos.filter((photo) => photo.kind === 'process').sort(byOrder);

export const newBuildWork = workPhotos
  .filter((photo) => photo.kind === 'new construction')
  .sort(byOrder);

export const allWork = [...workPhotos].sort(byOrder);

export function findWork(id: string) {
  return workPhotos.find((photo) => photo.id === id);
}

/** The strongest single elevation — used for the hero and social preview. */
export const heroPhoto = findWork('blue-gable-arch') ?? workPhotos[0];
