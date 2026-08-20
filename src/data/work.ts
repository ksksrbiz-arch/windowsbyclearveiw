export type WorkKind = 'after' | 'interior' | 'process';

export type WorkPhoto = {
  id: string;
  src: string;
  file: string;
  alt: string;
  caption: string;
  kind: WorkKind;
  featured: boolean;
  order: number;
};

export const workPhotos: WorkPhoto[] = [
  {
    id: 'stone-craftsman',
    file: 'e48a41d5-446c-4214-b86c-f2cb839114dd.jpe',
    src: '/work/stone-craftsman.jpg',
    alt: 'Two-story Washington house with stone veneer and cream vinyl windows after replacement',
    caption: 'Cream vinyl on a stone-and-siding elevation',
    kind: 'after',
    featured: true,
    order: 1,
  },
  {
    id: 'vaulted-grids',
    file: 'ef3c58d2-5fdf-4320-aed5-ef337fb1c9cd.jpe',
    src: '/work/vaulted-grids.jpg',
    alt: 'Pair of white double-hung windows with grids in a vaulted orange bedroom',
    caption: 'Double-hungs with grids, finished interior',
    kind: 'interior',
    featured: true,
    order: 2,
  },
  {
    id: 'tan-two-story',
    file: 'e0603003-78f6-4fc6-a60d-515fa1c1c028.jpe',
    src: '/work/tan-two-story.jpg',
    alt: 'Tan two-story house with new white sliders above a garage',
    caption: 'Sliders on a two-story elevation',
    kind: 'after',
    featured: true,
    order: 3,
  },
  {
    id: 'slider-shutters',
    file: '516123f4-e930-4db1-9fce-0ba56de74476.jpe',
    src: '/work/slider-shutters.jpg',
    alt: 'White slider window with shutters above a porch',
    caption: 'Slider and shutters over the porch',
    kind: 'after',
    featured: true,
    order: 4,
  },
  {
    id: 'blue-ladder',
    file: '851996dd-09fb-4465-92ec-35eed40a23ad.jpe',
    src: '/work/blue-ladder.jpg',
    alt: 'Installer on a ladder setting a window on a dark blue house',
    caption: 'On the ladder, mid-install',
    kind: 'process',
    featured: true,
    order: 5,
  },
  {
    id: 'new-unit-interior',
    file: 'b54f6e0b-d6a2-48e6-a961-86ef8831628a.jpe',
    src: '/work/new-unit-interior.jpg',
    alt: 'Homeowner standing beside a new white double-hung set in existing wood trim',
    caption: 'New unit in the existing opening',
    kind: 'interior',
    featured: true,
    order: 6,
  },
  {
    id: 'bedroom-view',
    file: 'dc54b60d-7072-4960-9892-ed59300a35e6.jpe',
    src: '/work/bedroom-view.jpg',
    alt: 'White double-hung window looking out over neighboring Washington rooftops',
    caption: 'Clear view from an upstairs room',
    kind: 'interior',
    featured: false,
    order: 7,
  },
  {
    id: 'two-story-white',
    file: 'b4b5efd0-f018-4532-8d62-84e6431aacde.jpe',
    src: '/work/two-story-white.jpg',
    alt: 'Stacked white vinyl windows on a two-story light siding house',
    caption: 'Stacked openings, one job',
    kind: 'after',
    featured: false,
    order: 8,
  },
  {
    id: 'ranch-slider',
    file: '3c597480-2ef4-4bdf-9ccd-560fec86120d.jpe',
    src: '/work/ranch-slider.jpg',
    alt: 'Wide white slider on a single-story ranch with deck furniture reflected in the glass',
    caption: 'Ranch slider, after',
    kind: 'after',
    featured: false,
    order: 9,
  },
  {
    id: 'ranch-stairs',
    file: 'ad122a25-d3fd-431a-9267-880bf654b564.jpe',
    src: '/work/ranch-stairs.jpg',
    alt: 'Slider window on a white ranch seen from a stair landing',
    caption: 'Same house, from the stairs',
    kind: 'after',
    featured: false,
    order: 10,
  },
  {
    id: 'tan-upper-slider',
    file: 'a8803cf8-08a7-472c-b997-4d72a6938925.jpe',
    src: '/work/tan-upper-slider.jpg',
    alt: 'Close view of an upper-story white slider on tan vertical siding',
    caption: 'Upper slider, tight trim',
    kind: 'after',
    featured: false,
    order: 11,
  },
  {
    id: 'blue-slider',
    file: '501a9a9c-2808-4b37-b382-d55a9374727d.jpe',
    src: '/work/blue-slider.jpg',
    alt: 'White slider on a dark blue house beside a wood deck',
    caption: 'Blue house slider',
    kind: 'after',
    featured: false,
    order: 12,
  },
  {
    id: 'blue-hung-ladder',
    file: 'cf8e95e0-40ae-4461-86fb-8494ac5dde64.jpe',
    src: '/work/blue-hung-ladder.jpg',
    alt: 'Single-hung window on a blue house with a ladder still in place',
    caption: 'Single-hung, just set',
    kind: 'process',
    featured: false,
    order: 13,
  },
  {
    id: 'blue-hung',
    file: 'a2b50b7d-e828-4a98-8a49-0343fd72de59.jpe',
    src: '/work/blue-hung.jpg',
    alt: 'Finished single-hung window on dark blue siding',
    caption: 'Finished hung on the blue house',
    kind: 'after',
    featured: false,
    order: 14,
  },
  {
    id: 'cream-side',
    file: '43258b26-4aed-4efb-b08f-05db29ca90d0.jpe',
    src: '/work/cream-side.jpg',
    alt: 'Cream-sided house with new windows, roses, and a crew member at the door',
    caption: 'Side elevation during the job',
    kind: 'process',
    featured: false,
    order: 15,
  },
  {
    id: 'cream-entry',
    file: '3a0d9a8a-cf4f-49e9-8de3-0a71c5e593ee.jpe',
    src: '/work/cream-entry.jpg',
    alt: 'Installer at the door of a cream house with new windows above',
    caption: 'Install day at the entry',
    kind: 'process',
    featured: false,
    order: 16,
  },
  {
    id: 'pink-bungalow',
    file: 'e137e13b-d8ff-4bf6-9215-4e1963ea2d79.jpe',
    src: '/work/pink-bungalow.jpg',
    alt: 'Pink bungalow with new white double-hung windows after replacement',
    caption: 'Pink bungalow, after',
    kind: 'after',
    featured: false,
    order: 17,
  },
  {
    id: 'pink-gable-ladder',
    file: 'acc1a295-5e14-44bb-939e-7a63fcbf29e0.jpe',
    src: '/work/pink-gable-ladder.jpg',
    alt: 'Ladder up to a new gable window on a pink shake house',
    caption: 'Gable opening from the ladder',
    kind: 'process',
    featured: false,
    order: 18,
  },
  {
    id: 'pink-gable',
    file: 'ff39343e-fe8d-4fcf-818e-959e68f5adc4.jpe',
    src: '/work/pink-gable.jpg',
    alt: 'White double-hung in the gable of a pink shake house',
    caption: 'Gable window, set',
    kind: 'after',
    featured: false,
    order: 19,
  },
];

export const featuredWork = workPhotos
  .filter((photo) => photo.featured)
  .sort((a, b) => a.order - b.order);

export const processWork = workPhotos
  .filter((photo) => photo.kind === 'process')
  .sort((a, b) => a.order - b.order);

export const allWork = [...workPhotos].sort((a, b) => a.order - b.order);
