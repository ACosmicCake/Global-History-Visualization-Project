// Shared helpers for the Living Atlas data store.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RECORDS = path.join(ROOT, 'records');
export const SCHEMA_VERSION = '1.0.0';

export const ENUMS = {
  status: ['stub', 'draft', 'incomplete', 'needs_review', 'outline', 'published'],
  kind: ['event', 'process', 'period', 'movement', 'person', 'place', 'polity', 'organization', 'work', 'species'],
  precision: ['minute', 'hour', 'day', 'month', 'year', 'decade', 'century', 'millennium', 'ten_millennia',
    'hundred_millennia', 'million_years', 'ten_million_years'],
  geometry: ['point', 'path', 'area', 'regions', 'global'],
  domains: ['geology_climate', 'life_extinction', 'human_evolution_migration', 'civilizations_empires', 'wars_conflict',
    'atrocity_injustice', 'law_politics_rights', 'people', 'science_technology', 'art_music_literature',
    'religion_philosophy', 'disease', 'trade_exploration', 'built_world'],
  regions: ['northern_africa', 'sub_saharan_africa', 'western_asia', 'central_asia', 'southern_asia', 'eastern_asia',
    'south_eastern_asia', 'europe', 'northern_america', 'latin_america_caribbean', 'oceania', 'antarctica', 'oceans', 'global'],
  related: ['caused', 'caused_by', 'part_of', 'has_part', 'same_person', 'same_place', 'contemporary', 'related'],
  template: ['point', 'path', 'region', 'flow', 'person', 'process', 'period', 'work', 'compare', 'directed'],
  sourceClass: ['primary', 'scholarly', 'museum', 'archive', 'government', 'reference', 'journalism', 'dataset', 'other'],
  confidence: ['established', 'probable', 'contested', 'legendary'],
  scale: ['deep_time', 'life', 'human_origins', 'prehistory', 'civilization', 'modern', 'event'],
  whoType: ['person', 'group', 'state', 'species', 'population', 'ecosystem', 'organization'],
};

export const today = () => new Date().toISOString().slice(0, 10);

export function recordPath(id) { return path.join(RECORDS, `${id}.json`); }
export function exists(id) { return fs.existsSync(recordPath(id)); }
export function load(id) { return JSON.parse(fs.readFileSync(recordPath(id), 'utf8')); }
export function save(rec) { writeAtomic(recordPath(rec.id), JSON.stringify(rec, null, 2) + '\n'); }
export function allIds() {
  return fs.readdirSync(RECORDS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
}
export function allRecords() { return allIds().map(load); }

export function readJSON(rel, fallback) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
}
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Atomic write (temp file + rename), retried because Windows briefly locks files other processes are reading.
export function writeAtomic(p, text) {
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, p); return; } catch (e) { if (i > 100) throw e; sleep(50); }
  }
}
export function writeJSON(rel, data) { writeAtomic(path.join(ROOT, rel), JSON.stringify(data, null, 2) + '\n'); }

// Store-wide lock for read-modify-write of queue, state, coverage and changelog (many agents run at once).
// Released when the process exits; a lock older than 60 s is treated as stale.
export function acquireLock() {
  const lock = path.join(ROOT, '.lock');
  for (;;) {
    try { fs.closeSync(fs.openSync(lock, 'wx')); break; } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 60000) fs.unlinkSync(lock); } catch {}
      sleep(50 + Math.random() * 100);
    }
  }
  const release = () => { process.removeListener('exit', release); try { fs.unlinkSync(lock); } catch {} };
  process.on('exit', release);
  return release;
}

export const words = s => (typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0);

// Normalised title/alias key for duplicate detection.
export const normName = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9\u0080-￿]+/g, ' ').trim();

// Century (or geological bin) of an astronomical year, for the coverage map.
export function timeBin(year) {
  if (year === undefined || year === null || Number.isNaN(year)) return 'unknown';
  if (year < -541000000) return 'precambrian';
  if (year < -251900000) return 'paleozoic';
  if (year < -66000000) return 'mesozoic';
  if (year < -2580000) return 'cenozoic_pre_quaternary';
  if (year < -300000) return 'early_pleistocene_hominins';
  if (year < -11700) return 'late_pleistocene';
  if (year < -3000) return 'early_holocene';
  // centuries: year 1..100 = 1st c. CE ("c01"); astronomical -99..0 = 100..1 BCE = 1st c. BCE ("c-01")
  return year > 0 ? `c${String(Math.ceil(year / 100)).padStart(2, '0')}`
    : `c-${String(Math.ceil((1 - year) / 100)).padStart(2, '0')}`;
}
