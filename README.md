# Living Atlas

Earth and human history on a 3D globe. Move through 4.5 billion years and open sourced records placed where and when they happened.

**Live site:** https://acosmiccake.github.io/Global-History-Visualization-Project/

The records are drafted and reviewed by AI models and tied to the sources they cite. No historian has checked them as a set. [How this is made](viewer/about.html) explains the rules and the limits.

## What's here

| Path | What it is |
| --- | --- |
| `viewer/` | The site: the globe (`app.js`, `space.js`, `spacecraft.js`, `sequence.js`), the tours, the plain HTML pages (`pages.mjs`), and the local server and static build |
| `atlas/records/` | One JSON file per record |
| `atlas/tools/` | The quality gate, publishing tools and research runners. See [atlas/README.md](atlas/README.md) |
| `atlas/spec.md`, `atlas/SPEC_AMENDMENTS.md` | What the atlas is meant to be and the rules for writing records |

## Run it

Needs Node 22. Nothing to install for the viewer.

```bash
node viewer/server.mjs            # http://localhost:8787, reads the records live
node viewer/build-static.mjs      # builds the static site into dist/
node atlas/tools/check-all.mjs    # the check CI runs before every deploy
```

Every push to `main` runs the check and, if it passes, deploys to GitHub Pages.

## Corrections

Every record has a "Report a problem" link, which opens a [GitHub issue](https://github.com/ACosmicCake/Global-History-Visualization-Project/issues). Reports are checked against sources and either fixed or answered with a reason.

## Licence

The code is under the [MIT licence](LICENSE). The records are under CC BY 4.0, and the third-party data has its own terms: see [LICENSE-DATA.md](LICENSE-DATA.md).
