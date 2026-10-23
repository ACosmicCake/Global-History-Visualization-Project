// Verify a Wikimedia Commons file's license and credit from its own metadata (spec 6.3).
// Usage: node atlas/tools/commons.mjs "File:Name.jpg" ["File:Other.png" ...]
//        node atlas/tools/commons.mjs --search "chicxulub crater gravity"     (lists candidate files)
const UA = { 'User-Agent': 'LivingAtlasHistorian/1.0 (research; contact via repository owner)' };
const API = 'https://commons.wikimedia.org/w/api.php';
// Commons rate-limits bursts from many agents: retry with backoff on 429/5xx.
async function getJSON(u) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(u, { headers: UA });
    if (r.ok) return r.json();
    if (r.status !== 429 && r.status < 500) throw new Error(`HTTP ${r.status}`);
    await new Promise(res => setTimeout(res, 2000 * 2 ** i + Math.random() * 1000));
  }
  throw new Error("rate-limited after retries");
}
const strip = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function info(title) {
  const u = `${API}?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|extmetadata|size&format=json`;
  const j = await getJSON(u);
  const page = Object.values(j.query.pages)[0];
  if (!page.imageinfo) return { title, error: 'no such file' };
  const ii = page.imageinfo[0], m = ii.extmetadata || {};
  return {
    title: page.title,
    file_url: ii.url.split('?')[0],
    source_url: ii.descriptionurl,
    license: strip(m.LicenseShortName?.value),
    license_url: strip(m.LicenseUrl?.value) || null,
    credit: [strip(m.Artist?.value), strip(m.Credit?.value)].filter(Boolean).join(' / '),
    description: strip(m.ImageDescription?.value).slice(0, 300),
    date: strip(m.DateTimeOriginal?.value),
    restrictions: strip(m.Restrictions?.value) || null,
    size: `${ii.width}x${ii.height}`,
  };
}

async function search(q) {
  const u = `${API}?action=query&list=search&srnamespace=6&srlimit=15&srsearch=${encodeURIComponent(q)}&format=json`;
  const j = await getJSON(u);
  return j.query.search.map(s => s.title);
}

const args = process.argv.slice(2);
if (args[0] === '--search') console.log((await search(args.slice(1).join(' '))).join('\n'));
else for (const t of args) console.log(JSON.stringify(await info(t.startsWith('File:') ? t : `File:${t}`), null, 2));
