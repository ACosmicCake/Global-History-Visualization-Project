// The viewer's shared state: the date, scale, filters, layers, loaded pins and the open record. One object, imported
// by every module that reads or changes it.
// The opening date: 500 BCE, which is astronomical year -499 (there is no year 0)
export const DEFAULT_T = -499;
export const state = {
  level: 4,
  t: DEFAULT_T,
  fossils: true,
  plateEdges: false,
  vitals: true, // set from the visitor's last choice in vitals.js
  vitalCurve: 'temp',
  whole: false,
  borders: true,
  paths: false,
  coastlines: false,
  clouds: false,
  realSun: false,
  pins: [],
  selected: null,
  alt: 2.4,
  off: new Set(),
  impOff: new Set(),
  regions: new Set(), // regions chosen in the legend; none chosen shows every region
  kinds: new Set(), // kinds chosen (person, place, event…); none chosen shows every kind
  seqPaused: false,
};
