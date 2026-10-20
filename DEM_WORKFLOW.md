# DEM Workflow

The 3D terrain has two modes, switched by the "Glacier state" control at the
top of the panel (a switch between `Little Ice Age` and `Today`):

1. `online`: the Mapterhorn DEM as published.
2. `lia`: Mapterhorn with the LIA surface blended in, per tile, in the browser.

## Build the web data

All three archives are built from `original-data/` with the `map-viewers`
conda environment (rasterio, scipy, geopandas, pmtiles, tippecanoe):

```bash
P=~/miniconda3/envs/map-viewers/bin/python
$P processing-files/build_lia_surface_patch.py     # ~35 s, ~24 MB
$P processing-files/build_lia_thickness_pmtiles.py # ~40 s, ~15 MB
$P processing-files/build_lia_outlines_pmtiles.py  # ~7 s,  ~7 MB
```

| archive in `local-data/` | content |
| --- | --- |
| `Alps-wide_LIA_surface_patch.pmtiles` | LIA surface for the 3D terrain, z0-z12, ice tiles only |
| `Alps-wide_LIA_glacier_thickness_soft.pmtiles` | thickness colours for display, soft margins |
| `Alps-wide_LIA_outlines.pmtiles` | outline polygons with popup attributes, z4-z13 |

The surface patch PNGs carry the elevation in R and G
(`(R * 256 + G) * 0.1 - 1000` m, MapLibre `custom` encoding), the blend weight
in B, and the ice mask in alpha. The weight is a smoothstep of the distance
inside the LIA outline. It is about 0 at the outline and 1 from `--feather`
(150 m) inward. It has its own channel because browsers premultiply alpha on
decode, which corrupts the RGB of partly transparent pixels.

## LIA terrain, composed in the browser

`js/lia-dem.js` registers the `lia-dem://{z}/{x}/{y}` protocol. For each tile it
fetches the online Mapterhorn tile (Terrarium, 512 px, to z17) and reads the
surface patch. Above z12 a tile reads the window of its z12 ancestor it covers.

- Tiles with no LIA ice return Mapterhorn's bytes unchanged.
- On the ice the LIA surface is interpolated with Catmull-Rom in the interior,
  and bilinearly near the margin and the tile edge.
- The result is `w * LIA + (1 - w) * Mapterhorn`, with `w` the blend weight
  interpolated bilinearly. The LIA surface fades into today's terrain across
  the 150 m band inside the outline instead of stepping at it.
- The result is re-encoded as Terrarium PNG. The hillshade reads the same
  source, so it shows the LIA surface too.

Nothing at z13-z17 is downloaded or stored locally. Only the patch archive
needs hosting.

An earlier approach baked Mapterhorn and the LIA surface into one offline
archive (`combine_lia_surface_with_mapterhorn.py`). It was dropped because
covering z13-z17 would have meant tens of GB of upsampled 50 m data, and the
script and its Mapterhorn extracts were removed on 2026-10-19.

## Viewer edit points

Search for the markers beginning with `#!!!!`:

- `js/config.js`: change `LIA_SURFACE_PATCH_URL` when the LIA surface patch
  moves or gets a new name.
- `js/lia-dem.js`: change how Mapterhorn and the LIA patch are blended per tile.
- `js/map.js`: change `TERRAIN_SOURCES` to add or remove terrain sources and
  `setTerrainMode()` to change how they are switched.
- `js/app.js` (`PERIODS`, `selectPeriod()`) and `index.html` (`#period-row`,
  `#lia-controls`): change what the glacier-state switch shows and hides.
- `data/lia-layers.json`: add display raster layers such as thickness or future
  colour products.

The archives are local-only and ignored by Git. For deployment see
[DEPLOYMENT.md](DEPLOYMENT.md).
