// Fill the numeric `year` of route waypoints from their own sourced `date` (or `label`) text, so the viewer can grow
// the route over time. Takes the first stated year (BCE converted to astronomical years) and, when a month is named,
// adds its fraction. Adds nothing the waypoint doesn't already state; waypoints with no year in their text are left alone.
// Usage: node atlas/tools/waypoint-years.mjs [--dry]
import { allRecords, save, today, acquireLock } from './lib.mjs';

const dry = process.argv.includes('--dry');
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function yearOf(text) {
  const t = String(text || '');
  const bce = t.match(/(\d{1,6})\s*(BCE|BC)\b/i);
  const ce = t.match(/\b(\d{3,4})\b(?!\s*(BCE|BC|ka|Ma|years))/i);
  let y = bce ? 1 - Number(bce[1]) : ce ? Number(ce[1]) : null;
  if (y == null) return null;
  const m = t.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  if (m && !bce) y += MONTHS.indexOf(m[1]) / 12;
  return Math.round(y * 100) / 100;
}

if (!dry) acquireLock();
let recs = 0, pts = 0;
for (const r of allRecords()) {
  const w = r.where?.geometry?.waypoints;
  if (!Array.isArray(w) || w.length < 2 || w.every(x => typeof x.year === 'number')) continue;
  let changed = false;
  for (const x of w) {
    if (typeof x.year === 'number') continue;
    const y = yearOf(x.date) ?? yearOf(x.label);
    if (y != null) { x.year = y; changed = true; pts++; }
  }
  const ys = w.map(x => x.year), lo = (r.when?.start?.year ?? -Infinity) - 1, hi = (r.when?.end?.year ?? Infinity) + 1;
  // a year outside the record's own span (e.g. a site's UNESCO inscription date) is not a travel date
  if (changed && ys.every(y => typeof y === 'number' && y >= lo && y <= hi) && ys.every((y, i) => !i || y >= ys[i - 1])) {
    r.updated = today(); if (!dry) save(r); recs++;
    console.log(`${r.id}: ${ys.join(', ')}`);
  } else if (changed) {
    for (const x of w) if (!(typeof x.year === 'number')) delete x.year;   // partial or out of order: leave the route static
    console.log(`${r.id}: skipped (years missing or out of order)`);
  }
}
console.log(`${dry ? 'would date' : 'dated'} ${pts} waypoints in ${recs} routes`);
