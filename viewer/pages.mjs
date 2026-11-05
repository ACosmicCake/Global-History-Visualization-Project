// Plain HTML versions of the atlas, shared by the static build and the local server: one page per record (so a record
// can be found by a search engine, previewed when shared, and read without WebGL), a browsable index of every record,
// and the sitemap. All record text is escaped: records are data written by agents.
export const SITE_URL = (process.env.SITE_URL || 'https://acosmiccake.github.io/Global-History-Visualization-Project/').replace(/\/?$/, '/');
export const REPO = 'ACosmicCake/Global-History-Visualization-Project';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…'; };
const paras = s => String(s || '').split(/\n+/).filter(Boolean).map(p => `<p>${esc(p)}</p>`).join('');
const REL = { caused: 'Led to', caused_by: 'Caused by', part_of: 'Part of', has_part: 'Includes', same_person: 'Same person', same_place: 'Same place', contemporary: 'Same time', related: 'Related', mentions: 'Mentions', mentioned_in: 'Mentioned in' };

function shell({ title, desc, path, root, body, image, type = 'website' }) {
  const url = SITE_URL + path, img = image || `${SITE_URL}assets/og.jpg`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:site_name" content="Living Atlas">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${root}site/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${root}site/pages.css">
</head>
<body>
<header class="top"><a class="home" href="${root}index.html">Living Atlas</a><nav><a href="${root}browse.html">All records</a><a href="${root}about.html">How this is made</a></nav></header>
<main>
${body}
</main>
</body>
</html>
`;
}

export function reportURL(id, title) {
  const body = `Record: ${id}\nPage: ${SITE_URL}r/${id}.html\n\nWhat looks wrong:\n\nA source that shows this (a link, if you have one):\n`;
  return `https://github.com/${REPO}/issues/new?labels=correction&title=${encodeURIComponent(`Correction: ${title}`)}&body=${encodeURIComponent(body)}`;
}

// pub: a record as recordPayload returns it; titles: Map of record id -> title
export function recordPage(pub, titles) {
  const img = (pub.media || []).find(m => m.type === 'image' && m.file_url);
  const rel = (pub.related || []).filter(x => titles.has(x.id));
  const wiki = pub.wiki?.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(pub.wiki.title.replace(/ /g, '_'))}` : null;
  const body = `<article>
<p class="kicker">${esc(pub.kind)} · ${esc(pub.confidence)} · importance ${esc(pub.importance?.score)}/5</p>
<h1>${esc(pub.title)}</h1>
<p class="when">${esc(pub.when?.display)}</p>
<p class="where">${esc(pub.where?.historical_name)}</p>
<p><a class="cta" href="../index.html#r=${esc(pub.id)}">Open on the globe</a></p>
${pub.status === 'outline' ? '<p class="note">A short record: a summary drawn from the sources below.</p>' : ''}
${pub.audience_note ? `<p class="warn">${esc(pub.audience_note)}</p>` : ''}
${img ? `<figure><img src="${esc(img.file_url)}" alt="${esc(img.title)}" loading="lazy"><figcaption>${esc(img.title)} · ${esc(img.credit)} · ${esc(img.license)}</figcaption></figure>` : ''}
${pub.card ? `<p class="lede">${esc(pub.card)}</p>` : `<div class="lede">${paras(pub.summary)}</div>`}
${pub.what ? `<h2>What happened</h2>${paras(pub.what)}` : ''}
${pub.why_it_matters ? `<h2>Why it matters</h2>${paras(pub.why_it_matters)}` : ''}
${pub.how ? `<h2>How it happened</h2>${paras(pub.how)}` : ''}
${(pub.perspectives || []).length ? `<h2>Perspectives</h2>${pub.perspectives.map(p => `<p><b>${esc(p.holder)}:</b> ${esc(p.account)}</p>`).join('')}` : ''}
${pub.visitor_note ? `<h2>Least certain</h2><p>${esc(pub.visitor_note)}</p>` : ''}
${rel.length ? `<h2>Connections</h2><ul class="rel">${rel.map(x => `<li><span>${esc(REL[x.type] || x.type)}</span> <a href="${esc(x.id)}.html">${esc(titles.get(x.id))}</a>${x.because ? ` <small>${esc(x.because)}</small>` : ''}</li>`).join('')}</ul>` : ''}
<h2>Sources</h2>
<ol class="srcs">${(pub.sources || []).map(s => `<li><a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.title)}</a> <small>${esc(s.publisher)} · ${esc(s.class)}${s.original_url ? ' · archived copy' : ''}</small></li>`).join('')}</ol>
${wiki ? `<p><a href="${esc(wiki)}" rel="noopener noreferrer">Read more on Wikipedia</a> <small>Further reading, not one of this record’s sources.</small></p>` : ''}
<p class="meta">Drafted and reviewed by AI models, then checked against its sources by automated tools. <a href="../about.html">How this is made</a> · <a href="${esc(reportURL(pub.id, pub.title))}" rel="noopener noreferrer">Report a problem</a> · version ${esc(pub.record_version)}, updated ${esc(pub.updated)}</p>
</article>`;
  return shell({ title: `${pub.title} · Living Atlas`, desc: clip(pub.summary, 160), path: `r/${pub.id}.html`, root: '../', body, image: img?.file_url, type: 'article' });
}

const ERAS = [
  ['Earth before life on land', -Infinity, -5.388e8], ['Life and the changing planet', -5.388e8, -7e6], ['Human origins', -7e6, -10000],
  ['First farmers and cities', -10000, -500], ['500 BCE to 500 CE', -500, 500], ['500 to 1000', 500, 1000], ['1000 to 1500', 1000, 1500],
  ['1500 to 1800', 1500, 1800], ['1800 to 1900', 1800, 1900], ['1900 to 1950', 1900, 1950], ['1950 to today', 1950, Infinity],
];
export function browsePage(recs) {
  const sorted = [...recs].sort((a, b) => a.when.start.year - b.when.start.year || a.title.localeCompare(b.title));
  const body = `<h1>All records</h1>
<p>Every record in the atlas in time order, ${recs.length.toLocaleString('en')} in all. This page needs no 3D graphics, so it also works on older devices and with screen readers.</p>
<label class="filter">Filter this page <input id="f" type="search" autocomplete="off"></label>
${ERAS.map(([name, from, to]) => {
    const rows = sorted.filter(r => r.when.start.year >= from && r.when.start.year < to);
    return rows.length ? `<section><h2>${esc(name)} <small>${rows.length}</small></h2><ul class="list">${rows.map(r => `<li><a href="r/${esc(r.id)}.html">${esc(r.title)}</a> <small>${esc(r.when.display)}</small></li>`).join('')}</ul></section>` : '';
  }).join('\n')}
<script>
document.getElementById('f').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('.list li').forEach(li => { li.hidden = !!q && !li.textContent.toLowerCase().includes(q); });
  document.querySelectorAll('main section').forEach(s => { s.hidden = !s.querySelector('li:not([hidden])'); });
});
</script>`;
  return shell({ title: 'All records · Living Atlas', desc: 'Every record in the Living Atlas in time order, from the formation of Earth to today, each with its sources.', path: 'browse.html', root: '', body });
}

export const sitemap = recs => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['', 'about.html', 'browse.html'].map(p => `<url><loc>${esc(SITE_URL + p)}</loc></url>`).join('\n')}
${recs.map(r => `<url><loc>${esc(`${SITE_URL}r/${r.id}.html`)}</loc>${r.updated ? `<lastmod>${esc(String(r.updated).slice(0, 10))}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
export const robots = () => `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`;
