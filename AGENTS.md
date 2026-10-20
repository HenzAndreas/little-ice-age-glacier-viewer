# Project agent guide

This repository is being adapted from Luis Q. Gentner's GLACE viewer into an Alps-wide Little Ice Age glacier viewer. Preserve that attribution in documentation and in any public-facing credits. The research-data citation is in `README.md`.

## Current goal

The first usable viewer should show:

- the LIA surface elevation raster;
- reconstructed glacier outlines;
- a terrain hillshade behind or over the raster;
- layer visibility and opacity controls;
- metadata popups for outline features, especially `LIA_ID`, ELA, area, volume, and source citation.

Do not add time or scenario controls, pixel-value inspection, download/export controls, or unrelated GLACE product axes unless the user requests them.

## Data boundary

`original-data/` contains local source material and is ignored by Git and GitHub Pages. It currently contains two large float32 TIFFs, a geometry CSV, and an EPSG:32632 shapefile. Never commit these files or make the browser fetch them as ordinary page assets.

The intended derived products are:

- Cloud-Optimized GeoTIFFs for analysis and remote range reads;
- Web Mercator raster tiles, preferably PMTiles, for display;
- simplified vector PMTiles for outlines and popup attributes.

For the surface layer, use the thickness raster as a positive-value mask. The
surface PMTiles should cover the thickness extent rather than the full DEM
extent, with transparent pixels outside glaciers. This keeps the online DEM
visible underneath and avoids publishing the unchanged off-glacier surface.

Use GDAL/Rasterio to inspect and transform the source data. Before writing a conversion script, record CRS, bounds, pixel size, nodata, value ranges, data type, and whether the off-glacier zero values are intentional. Keep the scientific raster values separate from display stretch and colour-map decisions.

## Reusable code

The useful inherited infrastructure is in `js/map.js`, `js/ui.js`, `scripts/serve.py`, the MapLibre setup in `index.html`, and the existing test helpers. The basemap, terrain, hillshade, layer ordering, opacity patterns, lazy vector overlay lifecycle, and safe DOM construction are reusable.

The following parts are GLACE-specific and should be replaced or isolated rather than extended for LIA data:

- `js/store.js` and the STAC mosaics collection;
- annual product/polarization/QA controls in `js/rasters.js`;
- the `glace-rgb://` COG protocol;
- the old Swiss inventory index and tile-grid path in `js/overlays.js`;
- GLACE catalog fixtures and tests;
- `scripts/build-tiles.py` as currently written, because it expects the old `data/inventories.json` schema.

Do not delete those references until the replacement viewer path has tests. Avoid broad rewrites of the map infrastructure.

## Local workflow

Use `python scripts/serve.py --tiles-dir local-data` and open `http://localhost:8000/` for the current local PMTiles archive. The custom server is needed for HTTP Range requests. Use `pixi run serve` when testing the default published-data mount, and `pixi run --locked test` for the current regression suite. When adding a data conversion script, add a small metadata/validation test that can run without the large source files.

Keep generated data under an ignored directory such as `derived-data/` or a local `tiles/` mount. Any remote object store used later must support anonymous reads, CORS, and exposed `Content-Range`, `Content-Length`, `Accept-Ranges`, and `ETag` headers.

## Editing principles

Make small, testable changes. Keep raw values and scientific metadata authoritative in the source/derived data, not duplicated in UI code. Build DOM nodes rather than interpolating catalog or feature properties into HTML. Do not remove user data or unrelated worktree changes. Do not commit changes unless explicitly asked.
