/*
 * Deployment endpoints and defaults, and the one place they are resolved.
 *
 * Three layers, in increasing precedence: the built-in defaults below, the
 * optional `site-config.js` a deployment can drop in beside index.html, and the
 * query parameters a reader can set from the address bar. `site-config.js` is a
 * plain script rather than another fetched JSON file so that overriding an
 * endpoint cannot introduce an asynchronous startup failure — it is either
 * there before the modules run or it is not.
 *
 * Only things a different deployment might reasonably point elsewhere live
 * here. Paint expressions, layout constants, the click radius and DOM ids stay
 * in the modules that use them; they are code, not configuration.
 */

const DEFAULTS = {
  /* Where the PMTiles archives are served from: `scripts/serve.py` mounts
   * local-data/ here, and the Pages workflow copies the release assets here. */
  tilesBase: "tiles",
  /* Appended to every archive name under tilesBase. Empty locally; the Pages
   * workflow sets ".png", because GitHub Pages gzips `.pmtiles` responses,
   * which breaks the byte ranges PMTiles reads, and leaves images alone. */
  archiveSuffix: "",
  /* The inventory archives are build outputs committed beside the page, so by
   * default they are served from the same origin as index.html. */
  inventoryBase: "data",

  /* Protomaps' hosted API: a TileJSON document, read the same way as the
   * Mapterhorn terrain below rather than as a PMTiles archive. Faster than the
   * Source Cooperative mirror this replaced, since it is served from
   * Protomaps' own edge rather than object storage, at the cost of the API key
   * baked into the URL below (from https://protomaps.com/api). */
  basemapUrl: "https://api.protomaps.com/tiles/v4.json?key=54af1e244a8f1599",
  basemapFlavor: "dark",
  basemapAssets: "https://protomaps.github.io/basemaps-assets",

  /* Esri's cached World Imagery service. Kept as a template rather than a
   * TileJSON document because MapLibre can read ArcGIS' XYZ endpoint directly. */
  worldImageryUrl:
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  /* Esri's imagery metadata: which source World Imagery draws at a point and
   * zoom, and when it was taken. One service per release; the newest is used. */
  worldImageryMetadata: "https://metadata.maptiles.arcgis.com/arcgis/rest/services",

  /* Mapterhorn global terrain, terrarium-encoded, 512 px WEBP tiles. */
  terrainTilejson: "https://tiles.mapterhorn.com/tilejson.json",
  terrainCredit: {
    title: "Mapterhorn Terrain Tiles",
    citation: "© Mapterhorn",
    links: [
      { label: "Attribution", url: "https://mapterhorn.com/attribution/" },
      { label: "Data Access", url: "https://mapterhorn.com/data-access/" },
    ],
  },

  /* Where the map opens when the URL carries no #hash naming a view. Centred
   * on the Aletsch Glacier, matching #10/46.51/8.03. `minZoom` stops the
   * globe short of a marble: at z1 the whole earth is on screen with its halo
   * around it, and MapLibre would otherwise go on to z-2. */
  initialView: { center: [8.03, 46.51], zoom: 10, minZoom: 1, maxZoom: 14 },
};

/* The subset a reader is expected to switch by hand, and the parameter name for
 * each. Anything not listed here is a deployment decision rather than a viewing
 * one, and is not reachable from the address bar. */
const QUERY_PARAMS = {
  tilesBase: "tiles",
  basemapUrl: "basemap",
  basemapFlavor: "flavor",
};

const site = globalThis.LIA_CONFIG ?? {};
for (const key of Object.keys(site)) {
  // Almost always a typo: a misspelled key would otherwise be silently ignored
  // and the deployment would look like it had no effect.
  if (!(key in DEFAULTS)) console.warn(`site-config.js: unknown setting '${key}'`);
}

const settings = {
  ...DEFAULTS,
  ...site,
  // Merged a key deeper, so naming one field of either does not drop the rest.
  initialView: { ...DEFAULTS.initialView, ...site.initialView },
  terrainCredit: { ...DEFAULTS.terrainCredit, ...site.terrainCredit },
};

const params = new URLSearchParams(location.search);
for (const [key, param] of Object.entries(QUERY_PARAMS)) {
  const value = params.get(param);
  if (value) settings[key] = value;
}

export const TILES_BASE = String(settings.tilesBase).replace(/\/$/, "");
export const ARCHIVE_SUFFIX = String(settings.archiveSuffix);
// The display rasters and their legends; archive paths in it are under TILES_BASE.
export const LAYER_MANIFEST_URL = "data/lia-layers.json";

export const INVENTORY_BASE = String(settings.inventoryBase).replace(/\/$/, "");
export const INVENTORY_INDEX_URL = `${INVENTORY_BASE}/inventories.json`;

export const BASEMAP_URL = settings.basemapUrl;
export const BASEMAP_FLAVOR = settings.basemapFlavor;
export const BASEMAP_ASSETS = settings.basemapAssets;
export const WORLD_IMAGERY_URL = settings.worldImageryUrl;
export const WORLD_IMAGERY_METADATA = String(settings.worldImageryMetadata).replace(/\/$/, "");

export const TERRAIN_TILEJSON = settings.terrainTilejson;
// #!!!! ADD HERE NEW TERRAIN/DEM SOURCES !!!!
// The LIA surface patch, z0-z12, from processing-files/build_lia_surface_patch.py:
// elevation in R and G, blend weight in B, ice mask in alpha. The 3D terrain
// blends it into Mapterhorn per tile — see js/lia-dem.js.
export const LIA_SURFACE_PATCH_URL = `${TILES_BASE}/Alps-wide_LIA_surface_patch.pmtiles${ARCHIVE_SUFFIX}`;
// LIA glacier outlines with popup attributes, from
// processing-files/build_lia_outlines_pmtiles.py (vector layer `lia_outlines`).
export const LIA_OUTLINES_URL = `${TILES_BASE}/Alps-wide_LIA_outlines.pmtiles${ARCHIVE_SUFFIX}`;
export const TERRAIN_CREDIT = settings.terrainCredit;

export const INITIAL_VIEW = settings.initialView;
