// The viewer's shared state: the date, scale, filters, layers, loaded pins and the open record. One object, imported
// by every module that reads or changes it.
export const state = {
  level: 4,
  t: -500,
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
