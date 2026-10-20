# Task log: LIA terrain and viewer

Working notes for continuing the Little Ice Age viewer. Read this together with
`AGENTS.md`, `README.md` and `DEM_WORKFLOW.md` and `DEPLOYMENT.md`. Last updated 2026-10-20.

## Goal

Show the Little Ice Age glaciers in the 3D map itself. The terrain mesh should
use today's high-resolution Mapterhorn DEM (to z17, about 1 m) everywhere, with
the 50 m LIA surface replacing it only where LIA ice existed. Avoid downloading
or re-hosting any high-resolution DEM.

## Decision: compose the terrain per tile in the browser

We rejected baking Mapterhorn and LIA into one archive at z13-z17. It would
mean tens of GB of upsampled 50 m data. A separate LIA mesh on top (deck.gl or
three.js) remains a later option.

The `lia-dem://{z}/{x}/{y}` protocol (`js/lia-dem.js`) fetches the online
Mapterhorn tile and blends in the LIA surface patch (z0-z12). Above z12 a tile
reads its window of the z12 ancestor. Tiles without ice pass through unchanged.

## Environment

- Python: `~/miniconda3/envs/map-viewers` has rasterio, scipy, geopandas,
  pmtiles and tippecanoe 2.79.0. tippecanoe and scipy were installed on
  2026-10-12.
- Node: none on PATH. Use the one bundled with VS Code:
  `~/.vscode-server/bin/*/node --test tests/lia-dem.test.js`.
- `pixi` and `npm` are not installed system-wide. For the jsdom tests, make a
  throwaway Node env (`conda create -p <scratch>/nodeenv -c conda-forge nodejs=24`),
  put its `bin` on PATH, then `npm ci && npm test` (72 tests, all pass on 2026-10-20).
- Python tests: `~/miniconda3/envs/map-viewers/bin/python -m unittest discover -s tests`
  (40 tests, all pass).
- Headless screenshots work with Windows Edge from WSL:
  `"/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot=...`.
  - Edge drops the `#hash` passed on the command line. Serve a one-line
    redirect page on another port that sets the hash in JavaScript.
  - The pitch must be ≤ 85° (`MAX_PITCH` in `js/map.js`), or MapLibre ignores the hash.
  - Use a profile in `C:\Windows\Temp\lia-edge-*` and delete it afterwards.

## Data (all under `local-data/`, built from `original-data/`)

| archive | script | time | size |
| --- | --- | --- | --- |
| `Alps-wide_LIA_surface_patch.pmtiles` | `processing-files/build_lia_surface_patch.py` | 35 s | 24 MB, 1103 tiles |
| `Alps-wide_LIA_glacier_thickness_soft.pmtiles` | `processing-files/build_lia_thickness_pmtiles.py` | 38 s | 15 MB, 1104 tiles |
| `Alps-wide_LIA_outlines.pmtiles` | `processing-files/build_lia_outlines_pmtiles.py` | 7 s | 7 MB, 4289 outlines |

Notes on the archives:

- **Surface patch encoding.** R, G hold the elevation:
  `(R*256+G)*0.1 - 1000` m, MapLibre `custom` encoding. B holds the blend
  weight × 255, a smoothstep of the distance inside the outline, reaching 1 at
  150 m. A is the ice mask, strictly 0/255. Checked against the source: median
  |diff| 1.4 m, p95 6.9 m, which comes from 50 m → 38 m reprojection on slopes.
- **Thickness colours** come from the ramp and stretch in `data/lia-layers.json`.
  The alpha is the ice mask blurred (σ 40 m) and passed through a smoothstep.
- **Outline attributes:** `LIA_ID`, `ela`, `area`, `Area_LIA`, `volume`,
  `lia_length`, `Citation`. The climate fields were left out.

## Done

- Per-tile 3D terrain composition with Catmull-Rom interior interpolation and
  soft margins from the blend weight. 14 Node tests.
- Glacier-state switch at the top of the panel, in `js/app.js` (`PERIODS`,
  `selectPeriod()`). Since 2026-10-19 it is one sliding toggle
  (`button#period`, `role="switch"`, `aria-checked="true"` = Today) rather
  than two buttons. The LIA-only controls are in `#lia-controls`.
- World Imagery is the default basemap.
- The hillshade is on by default. Its source is the composed terrain, so it
  shows the LIA surface relief in the LIA state.
- The 2D LIA relief patch layer was dropped (MapLibre's hillshade ignores
  alpha and drew cliffs at the margins); `js/lia-surface.js` was deleted on
  2026-10-19.
- The thickness raster uses `raster-resampling: linear` and the new
  soft-margin archive.
- LIA outlines are an amber line over a dark casing, with a transparent fill
  for clicking. They show in both states, controlled by the "LIA glacier
  outlines" checkbox. The popup (`liaOutlineRow` in `js/overlays.js`) shows
  ID, ELA, areas, volume, length, outline source and the Henz et al. (2025)
  citation.
- Generator tests are in `tests/test_build_lia_surface_patch.py` (7 tests,
  skipped without numpy/scipy).
- 2026-10-13: the basemap choice is now "World Imagery" (default) or
  "Hillshade" (`relief` in `setBasemap()`, `js/map.js`): a pale background
  with a full-tone hillshade from the active terrain source, replacing the
  dark Protomaps vector fills. The labels still come from Protomaps.
- 2026-10-13: the Swiss Glacier Inventories (SGI2016, SGI2023) were removed
  from `data/inventories.json`; only the Alpine Glacier Inventory (Paul et al.
  2020) is listed. The `sgi*.geojson` files are still in `data/`.
- 2026-10-13: the catalog tile grid checkbox, its overlay and popup were
  removed. `js/tile-grid.js` and its loader tests remain.
- 2026-10-13: a link to Henz et al. (2025) sits under the panel subtitle.
- 2026-10-19: intro tour, `js/tour.js`. Eight cards that spotlight the
  switch, the 3D button (with a "Show me Aletsch in 3D" flight), navigation,
  thickness, outlines, map options and the "?" replay button in the panel
  header. Opens once per browser (`localStorage` key
  `lia-viewer-tour-seen`); steps whose target is missing are skipped.
  Checked in headless Edge.
- 2026-10-19 cleanup (user approved): deleted `local-data/mapterhorn/`
  (140 GB), the combined Interlaken DEM, the two superseded archives, the old
  `generate_*`/`combine_*`/`download_mapterhorn_dem.sh` scripts and the pixi
  task, `js/lia-surface.js`, `js/tile-grid.js` with its test and parquet
  fixture, `gridIndex`/`hyparquetUrl`/`LIA_SURFACE_PATCH_ENCODING` in
  `js/config.js`, `data/sgi*.geojson`, all `*:Zone.Identifier` files.
  `local-data/` is now 45 MB and fully git-ignored. The encoding test now
  checks `PATCH_STEP`/`PATCH_BASE` in `js/lia-dem.js`.
- 2026-10-19: `DEPLOYMENT.md` and `.github/workflows/pages.yml` (GitHub Pages,
  data from a `data-v1` release). Not yet run: there is no Git repo yet.
- Verified in headless Edge at Aletsch: the 3D view, flat view, outlines,
  smooth thickness margins, and no console errors from our code.

- 2026-10-20: publishing checklist (see `DEPLOYMENT.md`). Removed the GLACE
  remnants (`js/store.js`, `js/cog-rgb.js`, their tests/fixtures, `lerc`);
  `js/rasters.js` now reads only `data/lia-layers.json` (`url` relative to
  `tilesBase`). Credits section, Zenodo data link, final DOI everywhere
  (archives rebuilt), new tour intro, favicons, meta description. Max pitch
  raised to 85° with a pale `sky` in the style. Collapsed sections and the
  collapsed panel show a plus (`.chevron.closed`), open ones a down chevron.
  `site-config.js` sets `window.LIA_CONFIG` (was `GLACE_CONFIG`). Viewer tests
  rewritten for the LIA page; the Pages workflow runs them before deploying.

## Next

1. **User check in a real browser.** The switch, the tour (clear
   `localStorage` or use "?" to see it again), the outline popup, the opacity
   slider, and the margins in 3D at z14.
2. **Deploy**: follow `DEPLOYMENT.md` steps 1-5 (git init, GitHub repo,
   `data-v1` release, Pages source = Actions, Protomaps key origins).
3. **Publishing checklist**: done except browser testing on the live site
   and an `og:image` once the URL is known.
4. ~~Stale viewer tests~~ — done 2026-10-20.
5. **Faint checker pattern** in the 3D blend band at z15+, from bilinear
   interpolation of the 26 m weight grid. Options: interpolate the weight with
   Catmull-Rom too, or write the patch at z13.
