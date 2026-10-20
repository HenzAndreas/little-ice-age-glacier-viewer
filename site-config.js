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
 *   tilesBase        "tiles"        where the LIA PMTiles archives are served
 *   archiveSuffix    ""             appended to each archive name; the Pages
 *                                   workflow sets ".png" (see pages.yml)
 *   inventoryBase    "data"         where the inventory archives and index live
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
 */

window.LIA_CONFIG = {
  /* `scripts/serve.py` mounts local-data/ here, and the Pages workflow copies
   * the release assets here, so the same path works locally and online. */
  tilesBase: "tiles",

  // A wide Alps opening view; refine this from the web-ready raster bounds.
  initialView: { center: [8.5, 46.5], zoom: 6, maxZoom: 14 },
};
