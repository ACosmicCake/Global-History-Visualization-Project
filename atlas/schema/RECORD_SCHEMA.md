# Living Atlas record schema — version 1.0.0

This is the machine form of spec section 4 (`atlas/spec.md`). Where this file and the spec differ, the spec wins; fix this file.
One record = one JSON file at `atlas/records/<id>.json`, UTF-8, 2-space indent. `node atlas/tools/gate.mjs <id>` runs the quality gate (spec section 10).

## Ids

Stable, lowercase, ASCII, hyphenated. Never change or delete a published id.

| Kind | Pattern | Example |
| --- | --- | --- |
| event, process, period, movement, work, species-free events | `<time>-<slug>` | `1945-08-06-hiroshima-bombing`, `-0479-battle-of-plataea`, `-66my-chicxulub-impact` |
| person | `person-<slug>` | `person-leonardo-da-vinci` |
| place | `place-<slug>` | `place-giza-pyramids` |
| polity | `polity-<slug>` | `polity-han-dynasty` |
| organization | `org-<slug>` | `org-united-nations` |
| species | `species-<slug>` | `species-homo-neanderthalensis` |

`<time>`: `YYYY-MM-DD` for day precision, `YYYY` otherwise (astronomical, 4 digits, minus sign for year ≤ 0: `-0479`); `-300ka` for thousands of years ago before 10,000 BCE; `-66my`, `-4540my` for millions of years.

## Fields

```jsonc
{
  "id": "1945-08-06-hiroshima-bombing",
  "schema_version": "1.0.0",
  "record_version": 1,                       // incremented on every publish
  "status": "draft",                         // stub | draft | incomplete | needs_review | published
  "kind": "event",                           // event | process | period | movement | person | place | polity | organization | work | species
  "title": "Atomic bombing of Hiroshima",    // short, neutral, specific
  "summary": "…",                            // reading depth 1: hover caption, 1–2 sentences, ≤ 45 words, stands alone
  "card": "…",                               // reading depth 2: exactly about three sentences, written fresh, not cut from `what`
  "what": "…",                               // reading depth 3: 150–400 words plain prose (biography for persons). Explain any source disagreement in one sentence here.
  "when": {
    "start": { "year": 1945, "iso": "1945-08-05T23:15:17Z" },   // year = astronomical proleptic Gregorian (1 BCE = 0, 480 BCE = -479). iso optional, UTC, only when day/hour known
    "end":   { "year": 1945, "iso": "1945-12-31" },
    "precision": "minute",                   // minute | hour | day | month | year | decade | century | millennium | ten_millennia | hundred_millennia | million_years | ten_million_years
    "uncertainty": { "start_minus_years": 0, "start_plus_years": 0, "end_minus_years": 0, "end_plus_years": 0, "note": "…" },
    "as_recorded": [ { "calendar": "Gregorian, JST (UTC+9)", "value": "6 August 1945, 8:15 a.m.", "source": "src-id" } ],
    "display": "6 August 1945, 8:15 a.m. JST"
  },
  "where": {
    "lat": 34.3955, "lon": 132.4536, "elevation_m": 600,      // modern WGS84; elevation of the event (burst height, site elevation)
    "modern_name": "Hiroshima, Japan",
    "historical_name": "Hiroshima, Empire of Japan",          // name and polity AT THE RECORD'S DATE
    "geometry": { "type": "point" },                          // point | path | area | regions | global
                                                              // path:   { "type":"path", "waypoints":[{ "lat","lon","date","label","source" }] }
                                                              // area:   { "type":"area", "description","polygon_source" , "bbox":[w,s,e,n] }
                                                              // regions:{ "type":"regions", "regions":[{ "name","lat","lon","note","source" }] }
    "uncertainty_km": 0.1,
    "coordinate_sources": ["src-a", "src-b"],                 // ≥ 2 source ids that confirm the coordinates
    "body": null,                                             // "Moon" etc. for off-Earth beats; pin stays at the Earth anchor
    "paleo": null,                                            // REQUIRED when when.start.year < -1,000,000:
                                                              // { "lat","lon","age_ma","plate_model","source" }  or  { "not_applicable": "reason" } (e.g. predates plate reconstructions, geometry global)
    "historical_geography_source": "src-id"                   // atlas/reconstruction backing the historical name/border/coastline
  },
  "regions": ["eastern_asia"],                // coverage regions, primary first (list below)
  "who": [ { "name": "…", "role": "…", "type": "person|group|state|species|population|ecosystem", "record_id": "person-… or null" } ],
  "how": "…",                                 // causes, mechanism, sequence. ≥ 60 words
  "why_it_matters": "…",                      // 100–300 words; ≥ 1 concrete consequence and ≥ 1 counterfactual. Written last.
  "domains": ["wars_conflict"],               // list below
  "related": [ { "id": "…", "type": "caused_by", "because": "one sentence on the mechanism (required for caused / caused_by)" } ],   // ≥ 5
  "media": [ { "type": "image", "title": "…", "file_url": "…", "source_url": "…", "license": "Public domain", "license_url": "…", "credit": "…", "verified": true } ],
  "animation": {
    "template": "point",                      // point | path | region | flow | person | process | period | work | compare | directed (directed: importance ≥ 4 only)
    "spec_version": 1,
    "duration_s": 45,                         // template < 60; directed 60–180
    "beats": [ { "span": "1945-08-06T08:15:17+09:00 / +0s", "action": "pulse { radius_m: 1600 }", "caption": "…", "source": "src-id", "consequence": false } ]
                                              // ≥ 2 beats; ≥ 1 beat with consequence: true whose caption states a consequence
  },
  "sources": [ {
    "id": "src-…", "url": "…", "title": "…", "publisher": "…", "author": "…", "date_published": "…",
    "accessed": "2026-10-21", "class": "primary|scholarly|museum|archive|government|reference|journalism|dataset|other",
    "opened": true,                           // you fetched and read the page itself; snippets do not count
    "supports": ["when", "where", "numbers.deaths"]
  } ],                                        // ≥ 3, ≥ 3 distinct publishers, ≥ 1 primary or scholarly. Wikipedia is never a source.
  "confidence": "established",                // established | probable | contested | legendary
  "provisional": false,                       // true for events under 5 years old
  "perspectives": [ { "holder": "…", "account": "…", "sources": ["src-id"] } ],    // ≥ 2 when contested
  "numbers": [ { "field": "deaths", "label": "…", "low": 90000, "high": 166000, "unit": "people", "estimate": true, "as_of": "end of 1945", "source": "src-id", "note": "…" } ],
  "audience_note": "…",                       // required for atrocity_injustice; set for any graphic content; else null
  "scale": "modern",                          // deep_time | life | human_origins | prehistory | civilization | modern | event
  "importance": { "score": 5, "justification": "one sentence" },
  "aliases": [ { "name": "広島市への原子爆弾投下", "language": "ja", "transliteration": "Hiroshima-shi e no genshi bakudan tōka", "period": "1945–present" } ],
  "model": null,                              // REQUIRED for kind=place with importance ≥ 3, see below
  "layers": ["wars", "science"],              // ambient/toggle layers this record belongs to
  "reviewer_note": "One line: what I am least sure of.",
  "parent_reconciliation": null,              // when a part_of parent has numbers: how this record's numbers fit the parent's
  "changelog": [ { "date": "2026-10-21", "version": 1, "change": "new" } ],
  "author": "historian-agent:<name>",
  "updated": "2026-10-21"
}
```

### `model` (place records, importance ≥ 3; spec 6.4)

```jsonc
"model": {
  "footprint": { "description": "…", "source": "src-id", "method": "surveyed|register|osm" },
  "geometry": { "type": "scan|procedural|reconstruction", "author": "…", "asset_url": "… or null", "license": "…", "source": "src-id",
                "measurements": [ { "part": "height", "value": 146.6, "unit": "m", "source": "src-id" } ] },
  "lod": [ { "level": "space", "representation": "lit marker" }, { "level": "regional", "representation": "…" }, { "level": "local", "representation": "…" }, { "level": "street", "representation": "…" } ],
  "phases": [ { "start_year": -2589, "end_year": -2566, "state": "construction|intact|altered|ruined|destroyed|restored", "description": "…", "source": "src-id" } ],
  "materials": [ { "from_year": -2560, "to_year": 1300, "material": "white Tura limestone casing", "source": "src-id" } ],
  "emphasis_label": "enlarged for visibility",
  "linear": null                            // for walls/roads/canals: { "cross_section": "…", "elements": [{ "type":"tower","lat","lon","source" }] }
}
```

## Enumerations

**domains**: `geology_climate`, `life_extinction`, `human_evolution_migration`, `civilizations_empires`, `wars_conflict`, `atrocity_injustice`, `law_politics_rights`, `people`, `science_technology`, `art_music_literature`, `religion_philosophy`, `disease`, `trade_exploration`, `built_world`.

**regions** (UN M49 macro/sub-regions, plus non-land codes): `northern_africa`, `sub_saharan_africa`, `western_asia`, `central_asia`, `southern_asia`, `eastern_asia`, `south_eastern_asia`, `europe`, `northern_america` (USA, Canada, Greenland, Bermuda, St Pierre & Miquelon), `latin_america_caribbean`, `oceania`, `antarctica`, `oceans`, `global`. The balance rule (≤ 40 % Europe + North America per 100 records) counts the primary region (`regions[0]`) being `europe` or `northern_america`.

**related.type**: `caused`, `caused_by`, `part_of`, `has_part`, `same_person`, `same_place`, `contemporary`, `related`.

**scale**: coarsest time level at which the pin appears (spec section 2). Children are at least as fine as their parents.

## Conventions (spec section 11)

- BCE/CE in prose; metric units with the source's original units in parentheses.
- Romanization: Pinyin, Hepburn, Revised Romanization, IJMES Arabic. Names as their own people wrote them; English exonyms go in `aliases`.
- Neutral voice. Atrocities in full, no euphemism, `audience_note` set. Legend recorded as belief, `legendary`.
- No quotation over 15 words; never copy passages; all prose in your own words.
- Numbers as ranges with provenance; `estimate: true` when they are estimates.
- Stubs: `{ id, title, kind, status: "stub", schema_version, created_from, created, note }` — never rendered.

## Outline tier (amendment A1, `atlas/SPEC_AMENDMENTS.md`)

A breadth-first record that `node atlas/tools/gate.mjs` checks with the lighter outline gate when it carries `"tier": "outline"`:

```jsonc
{
  "id": "1324-mansa-musa-hajj", "schema_version": "1.0.0", "record_version": 1, "tier": "outline", "status": "needs_review",
  "kind": "event", "title": "…", "summary": "15-90 words, own words",
  "when": { "start": { "year": 1324 }, "end": { "year": 1325 }, "precision": "year", "uncertainty": {…}, "as_recorded": [ { "calendar": "…", "value": "…", "source": "src-a" } ], "display": "1324–1325" },
  "where": { "lat": 0, "lon": 0, "elevation_m": null, "modern_name": "…", "historical_name": "…", "geometry": { "type": "point" }, "uncertainty_km": 25, "coordinate_sources": ["src-a"] },
  "regions": ["sub_saharan_africa"], "domains": ["trade_exploration"], "scale": "civilization",
  "importance": { "score": 3, "justification": "…" }, "confidence": "established", "audience_note": null,
  "related": [ { "id": "…", "type": "related" } ],             // optional for outlines
  "sources": [ /* ≥ 2 opened, 2 publishers, ≥ 1 not class "other" */ ],
  "reviewer_note": "…", "author": "historian-agent:…", "updated": "YYYY-MM-DD"
}
```
