/*
 * Per-deployment overrides for the viewer.
 *
 * A plain script rather than a module or a fetched JSON file, deliberately: it
 * is loaded before js/app.js and cannot fail asynchronously, so a deployment
 * can repoint the archives without adding another way for startup to break.
 * Everything here is optional, and everything left out falls back to the
 * built-in defaults in js/config.js. This copy is the GitHub Pages deployment
 * as well as the template, so it names the one thing that is not a sensible
 * built-in default: the bucket the archives are actually published to.
 *
 * Precedence is defaults -> this file -> query parameters, so `?tiles=` still
 * wins over `tilesBase` below and a reader can point the page somewhere else
 * without a redeploy.
 *
 * Keys, with their defaults:
 *
 *   tilesBase        "tiles"        the root of the future published data store
 *   inventoryBase    "data"         where the inventory archives and index live
 *   mosaicCollection "mosaics/collection.json"  the raster layers, under tilesBase
 *   gridIndex        "tiles/items.parquet"      the grid's item index, likewise
 *   cogReaderUrl     @developmentseed/geotiff on esm.sh, for js/cog-rgb.js
 *   hyparquetUrl     hyparquet on esm.sh, for the tile grid
 *   basemapUrl       Protomaps' hosted API, as a TileJSON URL with an API key
 *   basemapFlavor    "dark"         grayscale | black | dark | light | white
 *   basemapAssets    Protomaps' fonts and sprites endpoint
 *   worldImageryUrl  Esri World Imagery XYZ tile template
 *   terrainTilejson  Mapterhorn's global terrain
 *   terrainCredit    { title, citation, links } shown behind the hillshade's info mark
 *   initialView      { center: [lon, lat], zoom, maxZoom } before the #hash applies
 *
 * `initialView` and `terrainCredit` are merged key by key, so naming just
 * `zoom` keeps the default centre and maximum.
 *
 * The two library URLs are imported and executed, so unlike the endpoints above
 * they are not reachable from the address bar. Repoint them to pin a version or
 * to serve the libraries from your own origin; leave them alone otherwise.
 */

window.GLACE_CONFIG = {
  /* Local development uses the future `tiles/` mount. Keep the query override
   * available while the LIA conversion pipeline is being built. */
  tilesBase: "tiles",

  // A wide Alps opening view; refine this from the web-ready raster bounds.
  initialView: { center: [8.5, 46.5], zoom: 6, maxZoom: 14 },
};
