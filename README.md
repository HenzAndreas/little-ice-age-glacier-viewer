# Alps-wide Little Ice Age Glacier Viewer

An interactive MapLibre viewer for reconstructed Little Ice Age glacier geometry across the Alps. The first planned data layers are the LIA surface elevation and glacier outlines, with hillshade, opacity control, layer toggles, and outline metadata popups.

## Project origin

This project was originally based on Luis Q. Gentner's GLACE viewer and database/repository. The inherited viewer architecture, MapLibre integration, basemap and terrain handling, local range-support server, UI patterns, and parts of the test suite remain useful references. GLACE's Sentinel-1 products, STAC catalog, Swiss inventory data, and pre-styled raster assumptions are not the data model for this project.

## Research data

The current local source bundle is under `original-data/` and is excluded from Git and GitHub Pages:

| file | role | current format |
| --- | --- | --- |
| `Alps-wide_LIA_surface_elevation_with_glaciers_henz_et_al_2025.tif` | LIA surface elevation, including the off-glacier DEM | one uncompressed float32 TIFF, about 800 MB |
| `Alps-wide_LIA_glacier_thickness_henz_et_al_2025.tif` | glacier thickness, zero off glacier | one uncompressed float32 TIFF, about 300 MB |
| `Alps-wide_glacier_geometry_reconstruction_henz_et_al_2025_shapefile/` | reconstructed glacier polygons and attributes | ESRI Shapefile, 4,289 polygons, EPSG:32632 |
| `Alps-wide_glacier_geometry_50m_resolution_henz_et_al_2025.csv` | tabular glacier geometry and modelling metadata | CSV, including `LIA_ID`, `ela`, area, volume, and climate fields |

The supplied raster dimensions are consistent with 50 m data. Exact bounds, nodata handling, compression, and internal overviews still need to be checked with GDAL or Rasterio before conversion. The source CRS is UTM zone 32N, EPSG:32632, and the web viewer will need Web Mercator tiles or a browser projection strategy rather than the raw UTM TIFFs.

The research data comes from:

> Henz, A., Reinthaler, J., Nussbaumer, S. U., Leger, T. P. M., Kamleitner, S., Jouvet, G., & Vieli, A. (2025). Alps-wide high-resolution 3D modelling reconstruction of glacier geometry and climatic conditions for the Little Ice Age. *The Cryosphere*, 19(11), 5913–5937. [doi:10.5194/tc-19-5913-2025](https://doi.org/10.5194/tc-19-5913-2025)

The LIA glacier outlines come from Reinthaler, J. and Paul, F. (2025), *The Cryosphere*, [doi:10.5194/tc-19-753-2025](https://doi.org/10.5194/tc-19-753-2025).

The source data (rasters, outlines and glacier table) is archived on Zenodo: [doi:10.5281/zenodo.17608701](https://doi.org/10.5281/zenodo.17608701).

## Licences

- **Data:** the paper, the archived source data and the derived web layers in this viewer (the PMTiles archives) are licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Please cite Henz et al. (2025) when you use them.
- **Code:** MIT, see [LICENSE](LICENSE).
- **Third-party map data:** Esri World Imagery, OpenStreetMap/Protomaps labels and Mapterhorn terrain are used under their providers' terms on this public, non-commercial site. They are credited in the map's attribution control and in the page's Credits section.

## Credits

The viewer is adapted from Luis Q. Gentner's GLACE viewer. The code was adapted with the help of Claude (Anthropic).

## Data publication plan

The recommended browser products are:

1. Cloud-Optimized GeoTIFFs for continuous rasters, with tiling, compression, overviews, a documented nodata value, and the original values preserved.
2. Web Mercator raster tiles, preferably PMTiles or another range-readable archive, for efficient display at Alps-wide and close-up zooms.
3. Simplified vector PMTiles for glacier outlines, carrying only the popup and styling attributes needed by the viewer, including `LIA_ID`, `ela`, area, volume, and source citation.

The LIA surface is generated as a patch layer: the surface converter reads the
surface TIFF and the thickness TIFF together, uses positive thickness as an
alpha mask, and writes only tiles over the thickness extent. Transparent pixels
leave the online terrain DEM visible underneath. The thickness colour raster
is a separate layer above the surface patch.

The raw TIFFs should not be committed to GitHub or uploaded as ordinary page assets. A later preprocessing script will create the web products in a local ignored directory, and those products can then be published in object storage with CORS and HTTP range support. The existing `scripts/serve.py` is useful for testing that arrangement locally. For the first local thickness archive, run:

```bash
python scripts/serve.py --tiles-dir local-data
```

Then open `http://localhost:8000/`. The server exposes `local-data/` at the URL path `/tiles/`, while `data/lia-layers.json` tells the viewer which archive to load. This is an offline data workflow, although the basemap, terrain and MapLibre libraries still come from their configured web endpoints.

The page opens on World Imagery with the "Glacier state" switch on Little Ice
Age; flip it to see today. In that state, `js/lia-dem.js` builds each 3D terrain tile in the
browser from the online Mapterhorn tile (to z17, about 1 m) and the LIA surface
patch (to z12). The glaciers are part of the 3D surface and the hillshade, and
the surrounding terrain keeps Mapterhorn's full resolution. The thickness
colours are drawn on top. "Today" shows the present-day terrain and hides the
LIA layers. The LIA outlines (amber, click inside a glacier for its attributes)
are shown in both states. The three archives are built in under two minutes;
see [DEM_WORKFLOW.md](DEM_WORKFLOW.md).

The panel's "?" button replays a short intro tour (`js/tour.js`) that points
at each control, including the 3D button. It opens by itself on a first visit.
Future terrain and display-layer edit points are marked in the source with
`#!!!!` comments. For publishing the site and its data, see
[DEPLOYMENT.md](DEPLOYMENT.md).

## Technology and development

The project uses plain HTML, CSS, and native ES modules with no application build step. Rendering uses [MapLibre GL JS](https://maplibre.org/), the [Protomaps](https://protomaps.com) basemap, and [Mapterhorn](https://mapterhorn.com) terrain. Run the page with:

```bash
pixi run serve
```

Open `http://localhost:8000/`. Use `localhost`, not `127.0.0.1`, because the hosted basemap's local-development CORS allowance is hostname-specific.

Run the existing regression tests with:

```bash
pixi run --locked test
```