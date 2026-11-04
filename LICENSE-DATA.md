# Data licences

## The atlas's records

The records in `atlas/records/` are licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/). Please credit "Living Atlas" and link to the project. Records were drafted by AI models, and copyright in AI-written text may be limited in some countries.

This doesn't cover what records point to or quote. Linked pages, short quotations in `as_recorded` and images stay under their publishers' terms, and each record lists its sources.

## Third-party data shipped with the site

| Files | Source | Terms |
| --- | --- | --- |
| `viewer/site/borders/` | [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria), Seshat Global History Databank (Scientific Data 12, 247, 2025, doi:10.1038/s41597-025-04516-9) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Changed for this site: outlines simplified, small rings dropped, coordinates rounded (`atlas/tools/build-borders.mjs`) |
| `viewer/assets/shelf-depth.png` | NOAA ETOPO1 (Amante and Eakins 2009), reduced to a 1/6° grid and turned into shelf depth (`atlas/tools/build-sealevel.mjs`) | Free to use and redistribute; not for legal use, and provided without warranty |
| `viewer/assets/ice-sheets.png` | PaleoMIST 1.0: Gowan et al. 2021, Nature Communications 12:1199, doi:10.1038/s41467-021-21469-w; data doi:10.1594/PANGAEA.905800. One-degree ice thickness reduced to 8 bits (`atlas/tools/build-icesheets.mjs`) | CC BY 4.0 |
| `viewer/paleo/sealevel.json` | Spratt and Lisiecki 2016, Climate of the Past 12, doi:10.5194/cp-12-1-2016, from NOAA's paleoclimate archive | Credited here. Values rounded to the metre |
| `viewer/paleo/vitals.json`: temperature | Scotese et al. 2021, Earth-Science Reviews 215, data at [Zenodo 8238875](https://zenodo.org/records/8238875), area-weighted means of the grids; Hansen et al. 2013, Phil. Trans. R. Soc. A 371, doi:10.1098/rsta.2012.0294, from the authors' table; [HadCRUT5](https://www.metoffice.gov.uk/hadobs/hadcrut5/), Morice et al. 2021, doi:10.1029/2019JD032361, with 14 °C added to its 1961-90 anomalies (`atlas/tools/build-vitals.mjs`) | Scotese: CC BY 4.0. Hansen: the paper is CC BY 3.0, and the table is credited on that basis. HadCRUT5: contains public sector information licensed under the Open Government Licence v3.0 |
| `viewer/paleo/vitals.json`: CO₂ | Foster et al. 2017, Nature Communications 8:14845, its LOESS fit; [CenCO2PIP](https://zenodo.org/records/14537923) 2023, Science 382, eadi5177, medians of the vetted estimates (the medians are this site's and differ from the authors' fitted curve); [US EPA Climate Change Indicators](https://www.epa.gov/climate-indicators), its ice core column, June 2024; NOAA Global Monitoring Laboratory, Mauna Loa annual means (Lan and Keeling) | Foster and CenCO2PIP: CC BY 4.0. EPA: "may be freely distributed and used for non-commercial, scientific and educational purposes". NOAA: free with citation |
| `viewer/paleo/vitals.json`: sea level | Hansen et al. 2013 and Spratt and Lisiecki 2016, as above | As above |
| `viewer/paleo/vitals.json`: day length, Moon distance | Measurements tabled in Farhat et al. 2022, A&A 665, L1, [arXiv:2207.00438](https://arxiv.org/abs/2207.00438), joined with straight lines | Published figures, credited here |
| `viewer/assets/paleo-terrain.png` | PALEOMAP PaleoDEMs: Scotese and Wright 2018, [Zenodo 5460860](https://zenodo.org/records/5460860). 1-degree heights, every 5 million years to 540 Ma, carried from the PALEOMAP plate model onto today's map with rotations fitted through the GPlates Web Service, then reduced to 8 bits (`atlas/tools/build-terrain.mjs`) | CC BY 4.0 |
| `viewer/paleo/boundaries.json`, `viewer/assets/paleo-ridges.png` | Plate boundaries from MERDITH2021 (Merdith et al. 2021, Earth-Science Reviews 214, 103477; [Zenodo 4485738](https://zenodo.org/records/4485738)), through the GPlates Web Service; simplified, and turned into distance from ridges and subduction zones (`atlas/tools/build-plates.mjs`). The distance is a stand-in for seafloor age, not a measurement | CC BY 4.0 |
| `viewer/paleo/fossils.json`, and the known-genera curve in `viewer/paleo/vitals.json` | [Paleobiology Database](https://paleobiodb.org), reduced to half-degree cells; finds dated no better than 30 million years are left out, along with finds dated after a group's end (`atlas/tools/build-fossils.mjs`) | CC0, as its data service states on each download; credited here all the same |
| `viewer/paleo/morph.json` | MERDITH2021 plate model, through GPlates | Credited here |
| `viewer/site/land-110m.json` | Natural Earth | Public domain |
| `viewer/assets/` imagery | NASA and others | See `viewer/assets/CREDITS.md` |
| `atlas/wiki_aliases.json` | Wikidata | CC0 |
