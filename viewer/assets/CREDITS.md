# Texture credits

| File | Source | Licence |
| --- | --- | --- |
| earth-bluemarble-8k.jpg (8192 px, downsampled from the 21600 px July 2004 Blue Marble Next Generation below) | NASA Visible Earth | Public domain (NASA) |
| earth-day.webp (the first map drawn, and the fallback on weak graphics chips), earth-night.webp (both re-encoded from the original JPEGs as WebP), earth-water.png, earth-topology.png | three-globe example images (vasturiano/three-globe@2.27.2), derived from NASA Visible Earth: Blue Marble and Earth at Night (Black Marble) | NASA imagery is public domain; three-globe is MIT-licensed |
| earth-clouds.jpg (2048 px, greyscale: the three.js PNG's alpha times its brightness, recompressed), moon.jpg | three.js examples (mrdoob/three.js r149, examples/textures/planets), derived from NASA imagery | three.js is MIT-licensed; NASA imagery is public domain |

The night-lights texture shows modern (c. 2012) city lights. The viewer shows it only for dates from 1900 onward.
| tiles/bm-R-C.jpg (32 tiles, 2700 px each, 45° × 45°) | NASA Visible Earth, Blue Marble Next Generation with topography and bathymetry, July 2004, 21600 × 10800 (eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751) | Public domain (NASA) |
| shelf-depth.png (2160 × 1081, sea floor down to 150 m) | NOAA ETOPO1, Ice Surface (Amante and Eakins 2009), read at a 1/6° grid. Built by atlas/tools/build-sealevel.mjs | Free to use and redistribute; not for legal use, no warranty |
| og.jpg | Screenshot of this site, for link previews | Same as the imagery in it |
| ice-sheets.png (33 frames of 360 × 181, ice thickness for the last 80,000 years) | PaleoMIST 1.0 (Gowan et al. 2021, Nature Communications 12:1199; doi.org/10.1594/PANGAEA.905800), minimal scenario for North America before the last ice-age peak. Reduced to 8 bits by atlas/tools/build-icesheets.mjs | CC BY 4.0 |

# Code libraries

| File | Source | Licence |
| --- | --- | --- |
| vendor/three-0.149.0.min.js | three.js r149 (mrdoob/three.js), from npm three@0.149.0 | MIT (vendor/LICENSE-three) |
| vendor/globe.gl-2.27.2.min.js | globe.gl 2.27.2 (vasturiano/globe.gl), from npm globe.gl@2.27.2 | MIT (vendor/LICENSE-globe.gl) |
