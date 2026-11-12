// Definitions shared by the browser code (viewer/app/) and the plain pages (pages.mjs), so the globe and the HTML
// pages never disagree. Plain data only: no DOM, no Node APIs.

export const REPO = 'ACosmicCake/Global-History-Visualization-Project';

// How a link between two records reads, from the record that holds it ("A led to B"). Lower case; pages capitalise.
export const RELATION_LABELS = {
  caused: 'led to', caused_by: 'caused by', part_of: 'part of', has_part: 'includes', same_person: 'same person', same_place: 'same place',
  contemporary: 'same time', related: 'related', mentions: 'mentions', mentioned_in: 'mentioned in',
};

// Where each time scale starts, in astronomical years (each runs to today). The viewer's scales, levelFor (which scale
// a date belongs to) and goTo read these.
export const SCALE_START = { life: -5.4e8, human_origins: -7e6, prehistory: -3e5, civilization: -10000, modern: 1500 };
export const EARTH_FORMED = -4.54e9;
export const PHANEROZOIC_START = -5.388e8;   // ICS: the start of the eon of visible life, used by the eon strip and the browse page
