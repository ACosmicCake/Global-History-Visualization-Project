// Coverage map (spec 7, step 8): region × time bin × domain counts of published records,
// plus the balance check for the current 100-record batch (spec 8).
// Usage: node atlas/tools/coverage.mjs            -> rewrites atlas/coverage_map.json and prints a digest
import { ENUMS, allRecords, timeBin, writeJSON, today } from './lib.mjs';

const HUMAN_REGIONS = ENUMS.regions.filter(r => !['antarctica', 'oceans', 'global'].includes(r));

export function buildCoverage() {
  const pub = allRecords().filter(r => r.status === 'published')
    .sort((a, b) => String(a.published_at || '').localeCompare(String(b.published_at || '')) || a.id.localeCompare(b.id));
  const cells = {}, byRegion = {}, byBin = {}, byRegionBin = {};
  for (const r of pub) {
    const bin = timeBin(r.when?.start?.year);
    for (const reg of r.regions || []) {
      byRegion[reg] = (byRegion[reg] || 0) + 1;
      byRegionBin[`${reg}|${bin}`] = (byRegionBin[`${reg}|${bin}`] || 0) + 1;
      for (const d of r.domains || []) cells[`${reg}|${bin}|${d}`] = (cells[`${reg}|${bin}|${d}`] || 0) + 1;
    }
    byBin[bin] = (byBin[bin] || 0) + 1;
  }

  // Emptiest region × century cells from 3000 BCE (phase 2 target: ≥ 20 per cell).
  const centuries = [];
  for (let y = -2999; y <= 2000; y += 100) centuries.push(timeBin(y));
  const gaps = [];
  for (const reg of HUMAN_REGIONS) for (const c of centuries) gaps.push({ cell: `${reg}|${c}`, count: byRegionBin[`${reg}|${c}`] || 0 });
  gaps.sort((a, b) => a.count - b.count);

  // Balance of the current batch of 100 (publication order).
  const batchNo = Math.floor(Math.max(pub.length - 1, 0) / 100);
  const batch = pub.slice(batchNo * 100, batchNo * 100 + 100);
  const has = d => batch.filter(r => (r.domains || []).includes(d)).length;
  const balance = {
    batch: batchNo + 1,
    size: batch.length,
    europe_northern_america: batch.filter(r => ['europe', 'northern_america'].includes((r.regions || [])[0])).length,
    max_europe_northern_america: 40,
    art_music_literature: has('art_music_literature'), min_art: 10,
    science_technology: has('science_technology'), min_science: 10,
    before_1_ce: batch.filter(r => (r.when?.start?.year ?? 1) < 1).length, min_before_1_ce: 10,
    geology_climate: has('geology_climate'), min_geology: 5,
  };
  balance.europe_na_share = batch.length ? +(balance.europe_northern_america / batch.length).toFixed(3) : 0;
  balance.remaining_euro_na_slots = Math.max(0, 40 - balance.europe_northern_america);

  const map = {
    generated: today(), published: pub.length,
    by_region: byRegion, by_time_bin: byBin, region_time: byRegionBin, cells,
    emptiest_region_century: gaps.slice(0, 40), balance,
  };
  writeJSON('coverage_map.json', map);
  return map;
}

if (process.argv[1].endsWith('coverage.mjs')) {
  const m = buildCoverage();
  console.log(`published: ${m.published}`);
  console.log('by region:', JSON.stringify(m.by_region));
  console.log('balance:', JSON.stringify(m.balance));
  console.log('emptiest:', m.emptiest_region_century.slice(0, 12).map(g => `${g.cell}=${g.count}`).join(', '));
}
