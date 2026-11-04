# Data licences

## The atlas's records

The records in `atlas/records/` are licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Please credit "Living Atlas" and link to the project. Records were drafted by AI models, and copyright in AI-written text may be limited in some countries.

This doesn't cover what records point to or quote. Linked pages, short quotations in `as_recorded` and images stay under their publishers' terms, and each record lists its sources.

## Third-party data shipped with the site

| Files | Source | Terms |
| --- | --- | --- |
| `viewer/site/borders/` | [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria), Seshat Global History Databank (Scientific Data 12, 247, 2025, doi:10.1038/s41597-025-04516-9) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changed for this site: outlines simplified, small rings dropped, coordinates rounded (`atlas/tools/build-borders.mjs`) |
| `viewer/assets/shelf-depth.png` | NOAA ETOPO1 (Amante and Eakins 2009), reduced to a 1/6° grid and turned into shelf depth (`atlas/tools/build-sealevel.mjs`) | Free to use and redistribute; not for legal use, and provided without warranty |
| `viewer/paleo/sealevel.json` | Spratt and Lisiecki 2016, Climate of the Past 12, doi:10.5194/cp-12-1-2016, from NOAA's paleoclimate archive | Credited here. Values rounded to the metre |
| `viewer/paleo/morph.json` | MERDITH2021 plate model, through GPlates | Credited here |
| `viewer/site/land-110m.json` | Natural Earth | Public domain |
| `viewer/assets/` imagery | NASA and others | See `viewer/assets/CREDITS.md` |
| `atlas/wiki_aliases.json` | Wikidata | CC0 |
