/*
 * The LIA display rasters — today the ice thickness — with the opacity slider
 * and the legend that describes them.
 *
 * The layers are listed in data/lia-layers.json, one record per PMTiles archive:
 * where it is, its zooms, and the ramp and stretch it was rendered with. The
 * colours are baked into the archive by processing-files/build_lia_*.py; the
 * manifest only repeats them for the legend, so the page holds no scientific
 * values of its own.
 */

import { LAYER_MANIFEST_URL, TILES_BASE } from "./config.js";
import { addStacked, map, styleReady } from "./map.js";
import { clearStatus, el, isFiniteNumber, isNonEmptyString, setStatus } from "./ui.js";

const STATUS_KEY = "rasters";

const state = {
  layer: null,
  opacity: 1,
  // False under "Today": the LIA layers have no meaning on today's terrain.
  shown: true,
  added: false,
};

/* ---------- the manifest ---------- */

/* A record the page can draw and describe. The manifest is a committed file,
 * but the archive path in it can be repointed with `?tiles=`, so an incomplete
 * record is dropped with a warning rather than failing later inside MapLibre. */
function drawable(layer) {
  return (
    layer !== null &&
    typeof layer === "object" &&
    isNonEmptyString(layer.id) &&
    isNonEmptyString(layer.url) &&
    isFiniteNumber(layer.minZoom) &&
    isFiniteNumber(layer.maxZoom) &&
    layer.minZoom <= layer.maxZoom &&
    isFiniteNumber(layer.vmin) &&
    isFiniteNumber(layer.vmax) &&
    layer.vmin < layer.vmax &&
    Array.isArray(layer.colors) &&
    layer.colors.length >= 2 &&
    layer.colors.every(isNonEmptyString)
  );
}

/**
 * The usable layers of a manifest, with each archive path resolved under
 * `tilesBase`. Throws when nothing in it can be drawn.
 *
 * @param {object} manifest  the parsed data/lia-layers.json
 * @param {string} [tilesBase]
 */
export function manifestLayers(manifest, tilesBase = TILES_BASE) {
  const records = Array.isArray(manifest?.layers) ? manifest.layers : [];
  const usable = records.filter((layer) => {
    const ok = drawable(layer);
    if (!ok) console.warn("lia-layers.json: skipping malformed layer", layer);
    return ok;
  });
  if (!usable.length) throw new Error("the layer manifest lists no drawable layer");
  return usable.map((layer) => ({
    ...layer,
    // An absolute URL is kept as it is; a bare file name lives under tilesBase.
    url: /^[a-z]+:|^\//i.test(layer.url) ? layer.url : `${tilesBase}/${layer.url}`,
  }));
}

/* ---------- map layer ---------- */

function ensureLayer(layer) {
  if (state.added) return;
  /* No `attribution` or `bounds`: the archive carries both in its own header,
   * and `pmtiles.Protocol({metadata: true})` hands them to MapLibre. */
  map.addSource(layer.id, {
    type: "raster",
    url: `pmtiles://${layer.url}`,
    tileSize: 256,
    minzoom: layer.minZoom,
    maxzoom: layer.maxZoom,
  });
  addStacked("data", {
    id: layer.id,
    type: "raster",
    source: layer.id,
    layout: { visibility: "none" },
    // Linear, not nearest: zoomed past z12 the 50 m data would otherwise show
    // its pixels as stair steps along every glacier margin.
    paint: { "raster-opacity": state.opacity, "raster-resampling": "linear" },
  });
  state.added = true;
}

/* A raster source that cannot load says nothing on its own: MapLibre fires an
 * `error` event and the map just stays empty. Only the first failure is
 * reported — a viewport failing twenty tiles is one broken layer — and a tile
 * MapLibre cancelled is not a failure at all. */
let reported = false;

map.on("error", (event) => {
  if (reported || !state.layer || event.sourceId !== state.layer.id) return;
  if (event.error?.name === "AbortError") return;
  reported = true;
  setStatus(
    STATUS_KEY,
    `The ice thickness could not be drawn — ${event.error?.message ?? "its tiles could not be read"}`,
    "error",
  );
});

/* Repeated calls settle in order, so the last one wins. */
async function showOnMap() {
  await styleReady;
  const { layer } = state;
  if (!layer) return;
  if (!state.shown && !state.added) return;
  ensureLayer(layer);
  map.setLayoutProperty(layer.id, "visibility", state.shown ? "visible" : "none");
  map.setPaintProperty(layer.id, "raster-opacity", state.opacity);
}

/* Shows or hides the LIA raster; called by the glacier-state switch. */
export function setRastersShown(on) {
  state.shown = on;
  showOnMap();
}

/* ---------- legend ---------- */

const round = (value, span) => value.toFixed(Math.abs(span) < 5 ? 2 : 0);

function updateLegend(layer) {
  el("legend-bar").style.background = `linear-gradient(to right, ${layer.colors.join(", ")})`;
  const unit = isNonEmptyString(layer.units) ? ` ${layer.units}` : "";
  const span = layer.vmax - layer.vmin;
  el("legend-min").textContent = round(layer.vmin, span) + unit;
  el("legend-max").textContent = round(layer.vmax, span) + unit;
  if (isNonEmptyString(layer.title)) el("raster-title").textContent = layer.title;
}

/* ---------- boot ---------- */

/* When the manifest cannot be read, hide the controls that describe the raster
 * and say so once, rather than leaving a dead slider behind an error message. */
function noRasters(reason) {
  el("raster-controls").hidden = true;
  setStatus(STATUS_KEY, `No LIA layers: ${reason}. Basemap and terrain still work.`, "error");
}

export async function loadRasters() {
  setStatus(STATUS_KEY, "Loading layers…");
  let layers;
  try {
    const response = await fetch(LAYER_MANIFEST_URL);
    if (!response.ok) throw new Error(`${LAYER_MANIFEST_URL} — HTTP ${response.status}`);
    layers = manifestLayers(await response.json());
  } catch (error) {
    noRasters(error.message);
    return null;
  }
  clearStatus(STATUS_KEY);

  // One display raster today; the manifest's first entry is the one shown.
  [state.layer] = layers;
  updateLegend(state.layer);

  el("opacity").addEventListener("input", (event) => {
    state.opacity = Number(event.target.value) / 100;
    el("opacity-value").textContent = `${event.target.value}%`;
    showOnMap();
  });
  await showOnMap();
  return state.layer;
}
