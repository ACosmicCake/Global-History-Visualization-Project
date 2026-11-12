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

// The region each record is filed under (its pin's region field), as a visitor reads it. "global" records have no
// single place.
export const REGION_LABELS = {
  europe: 'Europe', western_asia: 'Western Asia', central_asia: 'Central Asia', southern_asia: 'South Asia', eastern_asia: 'East Asia',
  south_eastern_asia: 'Southeast Asia', northern_africa: 'North Africa', sub_saharan_africa: 'Sub-Saharan Africa',
  northern_america: 'North America', latin_america_caribbean: 'Latin America and the Caribbean', oceania: 'Oceania',
  antarctica: 'Antarctica', oceans: 'the oceans', global: 'the whole planet',
};

// Kinds of record, as the legend's filter names them (plural)
export const KIND_LABELS = {
  event: 'Events', person: 'People', place: 'Places', process: 'Processes', work: 'Works', polity: 'States and empires',
  movement: 'Movements', period: 'Periods', organization: 'Organizations', species: 'Species',
};
