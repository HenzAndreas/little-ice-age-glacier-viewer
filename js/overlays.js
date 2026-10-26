/*
 * Vector overlays: the LIA glacier outlines and the glacier inventories.
 *
 * Both share one lifecycle: nothing is created until the box is first ticked,
 * and a failure rolls the layers back so re-ticking is a fresh attempt rather
 * than a no-op. `LazyOverlay` is that lifecycle.
 */

import { INVENTORY_BASE, INVENTORY_INDEX_URL, LIA_OUTLINES_URL } from "./config.js";
import { addStacked, map, styleReady } from "./map.js";
import { countEvent } from "./analytics.js";
import { clearStatus, collapsible, creditButton, el, h, isNonEmptyString, setStatus } from "./ui.js";

/* ---------- the shared lazy-source lifecycle ---------- */

class LazyOverlay {
  /**
   * @param {object} spec
   * @param {string} spec.sourceId    MapLibre source id, also the status key.
   * @param {string[]} spec.layerIds  Layers to add, remove and toggle together.
   * @param {string} spec.label       Shown while the archive is loading.
   * @param {() => void} spec.add     Adds the source and the layers.
   * @param {(error?: Error) => string} spec.failure  Message for a failed load.
   * @param {() => HTMLInputElement} spec.checkbox    The box to untick on failure.
   */
  constructor(spec) {
    Object.assign(this, spec);
    this.loaded = false;
  }

  /* Awaiting the style is what makes a box ticked while the basemap is still
   * loading behave the same as one ticked afterwards: the click is honoured
   * when the style arrives instead of being dropped. Repeated toggles settle in
   * call order, so the last one wins. */
  async setEnabled(on) {
    await styleReady;
    if (this.loaded) {
      const visibility = on ? "visible" : "none";
      for (const id of this.layerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visibility);
      }
      return;
    }
    if (!on) return;
    setStatus(this.sourceId, `Loading ${this.label}…`);
    /* `add` may be asynchronous. Both failure paths, a throw here and a source
     * error later, land in the same place: roll back, untick, and say so. */
    try {
      await this.add();
    } catch (error) {
      this.fail(error);
      return;
    }
    this.loaded = true;
    this.watch();
  }

  /* Roll back, so re-ticking the box is a fresh attempt rather than a no-op. */
  fail(error) {
    this.remove();
    const box = this.checkbox();
    if (box) box.checked = false;
    setStatus(this.sourceId, this.failure(error), "error");
  }

  remove() {
    for (const id of this.layerIds) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(this.sourceId)) map.removeSource(this.sourceId);
    this.loaded = false;
  }

  /* Because the source loads itself, success and failure arrive as map events
   * rather than as the resolution of a fetch. Both are one-shot: the listeners
   * take themselves off again so later tile activity on the source is ignored. */
  watch() {
    const stop = () => {
      map.off("sourcedata", onData);
      map.off("error", onError);
    };
    const onData = (event) => {
      if (event.sourceId !== this.sourceId || !map.isSourceLoaded(this.sourceId)) return;
      stop();
      clearStatus(this.sourceId);
    };
    const onError = (event) => {
      if (event.sourceId !== this.sourceId) return;
      stop();
      this.fail(event.error);
    };
    map.on("sourcedata", onData);
    map.on("error", onError);
  }
}

/* ---------- glacier inventories ---------- */

/* Each inventory is a vector archive built from the committed GeoJSON by
 * scripts/build-tiles.py, so the browser pulls only the tiles the view covers
 * and the outlines draw as the first tiles land. */
const inventories = new Map();

/* The index is fetched, so it gets the same treatment as the layer manifest:
 * an entry missing the fields the overlay is built from is dropped rather than
 * allowed to fail later inside MapLibre. */
function validateInventoryIndex(raw) {
  if (raw === null || typeof raw !== "object" || !Array.isArray(raw.inventories)) return [];
  return raw.inventories.filter((entry) => {
    const ok =
      entry !== null &&
      typeof entry === "object" &&
      isNonEmptyString(entry.id) &&
      isNonEmptyString(entry.title) &&
      isNonEmptyString(entry.url) &&
      isNonEmptyString(entry.color);
    if (!ok) console.warn("inventories.json: skipping malformed entry", entry);
    return ok;
  });
}

function inventoryOverlay(entry) {
  const lineId = `inv-line-${entry.id}`;
  const sourceLayer = entry.source_layer || entry.id;
  return new LazyOverlay({
    sourceId: `inv-${entry.id}`,
    layerIds: [`${lineId}-casing`, lineId],
    label: entry.title,
    checkbox: () => el(`inv-${entry.id}`),
    failure: (error) => `${entry.title} unavailable (${error?.message ?? "load failed"})`,
    add() {
      if (entry.format === "geojson") {
        map.addSource(this.sourceId, {
          type: "geojson",
          data: `${INVENTORY_BASE}/${entry.local_url}`,
        });
      } else {
      map.addSource(this.sourceId, {
        type: "vector",
        url: `pmtiles://${INVENTORY_BASE}/${entry.url}`,
      });
      }
      /* Outlines only — a fill would hide the imagery the outline is there to
       * be compared against. The dark casing keeps them legible over both the
       * pale and the dark end of the colour ramps. `source-layer` must match
       * the layer name tippecanoe was given. */
      addStacked("overlay", {
        id: `${lineId}-casing`,
        type: "line",
        source: this.sourceId,
        ...(entry.format === "geojson" ? {} : { "source-layer": sourceLayer }),
        paint: {
          "line-color": "rgba(0,0,0,0.55)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.8, 10, 3, 14, 4.4],
          "line-opacity": 0.8,
        },
      });
      addStacked("overlay", {
        id: lineId,
        type: "line",
        source: this.sourceId,
        ...(entry.format === "geojson" ? {} : { "source-layer": sourceLayer }),
        paint: {
          "line-color": entry.color,
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 1.2, 14, 2],
        },
      });
    },
  });
}

export async function loadInventories() {
  let index;
  try {
    const response = await fetch(INVENTORY_INDEX_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    index = validateInventoryIndex(await response.json());
  } catch {
    // Overlays are optional; the page works without them.
    return;
  }

  const node = el("inventories");
  node.replaceChildren();
  for (const entry of index) {
    const overlay = inventoryOverlay(entry);
    inventories.set(entry.id, { entry, overlay });

    const box = h("input", { type: "checkbox", id: `inv-${entry.id}` });
    box.addEventListener("change", () => overlay.setEnabled(box.checked));
    // No forced break: the name wraps on its own where the panel is narrow, and
    // the span follows it inline so the row never runs to three lines.
    const label = h(
      "label",
      { htmlFor: box.id },
      `${entry.title} `,
      entry.span ? h("span", { class: "span", textContent: `(${entry.span})` }) : null,
    );
    node.append(
      h(
        "div",
        { class: "inventory" },
        box,
        h("span", { class: "swatch", style: { background: entry.color } }),
        label,
        creditButton(entry.title, entry),
      ),
    );
  }
  el("inventories-section").hidden = index.length === 0;

  collapsible("inventories-toggle", "inventories");
}

/* ---------- LIA glacier outlines ---------- */

const LIA_OUTLINE_FILL = "lia-outline-fill";

/* The reconstructed outlines, shown under either glacier state: on the LIA
 * surface they bound the ice, on today's terrain they show how far it reached.
 * Lines only, in amber over a dark casing, which stays legible on snow in the
 * imagery and on the blues of the thickness ramp. The fill is fully
 * transparent and exists to be clicked: a click anywhere inside a glacier
 * opens its popup. */
export const liaOutlines = new LazyOverlay({
  sourceId: "lia-outlines",
  layerIds: [LIA_OUTLINE_FILL, "lia-outline-casing", "lia-outline-line"],
  label: "LIA outlines",
  checkbox: () => el("lia-outlines"),
  failure: (error) => `LIA outlines unavailable (${error?.message ?? "load failed"})`,
  add() {
    map.addSource(this.sourceId, { type: "vector", url: `pmtiles://${LIA_OUTLINES_URL}` });
    const layer = { source: this.sourceId, "source-layer": "lia_outlines" };
    addStacked("overlay", {
      id: LIA_OUTLINE_FILL,
      type: "fill",
      ...layer,
      paint: { "fill-color": "rgba(0, 0, 0, 0)" },
    });
    addStacked("overlay", {
      id: "lia-outline-casing",
      type: "line",
      ...layer,
      paint: {
        "line-color": "rgba(0, 0, 0, 0.5)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 10, 2.8, 14, 4.2],
      },
    });
    addStacked("overlay", {
      id: "lia-outline-line",
      type: "line",
      ...layer,
      paint: {
        "line-color": "#ffc531",
        "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 10, 1.2, 14, 2],
      },
    });
  },
});

/* ---------- popups ---------- */

/* A one-pixel outline is nearly impossible to hit, so clicks are resolved
 * against a box around the pointer rather than the rendered line itself. This
 * also lets several overlapping inventories answer one click. */
const CLICK_RADIUS_PX = 8;

/* One handler for every clickable overlay: querying them together means a
 * single click reports everything under it in one popup rather than racing two
 * handlers to open competing ones. */
function clickableLayers() {
  const layers = [...inventories.values()]
    .filter(({ entry, overlay }) => overlay.loaded && el(`inv-${entry.id}`)?.checked)
    .map(({ entry }) => `inv-line-${entry.id}`);
  if (liaOutlines.loaded && el("lia-outlines")?.checked) layers.push(LIA_OUTLINE_FILL);
  return layers.filter((id) => map.getLayer(id));
}

/* Every popup section reads the same way: a muted uppercase heading styled like
 * the panel's own field labels, then `label: value` lines. Fields whose value is
 * missing are dropped rather than shown empty.
 *
 * Built as nodes, not as an HTML string: the values are vector-tile properties,
 * and a glacier name containing markup must stay a glacier name. */
function popupSection(heading, fields) {
  const nodes = [h("div", { class: "pop-head", textContent: heading })];
  for (const [label, value] of fields) {
    if (value === null || value === undefined || value === "") continue;
    nodes.push(h("div", {}, h("span", { class: "pk", textContent: `${label}:` }), ` ${value}`));
  }
  return nodes;
}

function inventoryRow(feature) {
  const id = feature.layer.id.replace("inv-line-", "");
  const { entry } = inventories.get(id);
  const props = feature.properties;
  // Paul et al. ships no names but does carry its own glacier number, so each
  // inventory is described by whichever identifier it actually has.
  const identity =
    props.glacier_nr === undefined
      ? ["Glacier name", props.name || "No name provided"]
      : ["Glacier number", props.glacier_nr];
  return popupSection(entry.title, [identity, ["Acquisition year", props.year]]);
}

const withUnit = (value, unit) =>
  value === null || value === undefined || value === "" ? null : `${value} ${unit}`;

/* The attributes are the outline table's, rounded by the build script; only the
 * labels and units are the page's. */
export function liaOutlineRow(feature) {
  const props = feature.properties;
  return popupSection("LIA glacier", [
    ["LIA ID", props.LIA_ID],
    ["ELA", withUnit(props.ela, "m a.s.l.")],
    ["Area, modelled", withUnit(props.area, "km²")],
    ["Area, LIA outline", withUnit(props.Area_LIA, "km²")],
    ["Volume", withUnit(props.volume, "km³")],
    ["Length", withUnit(props.lia_length, "m")],
    ["Outline source", props.Citation],
    ["Outline inventory", "Reinthaler and Paul (2025), The Cryosphere, doi:10.5194/tc-19-753-2025"],
    ["Reconstruction", "Henz et al. (2025), The Cryosphere, doi:10.5194/tc-19-5913-2025"],
  ]);
}

map.on("click", (event) => {
  const layers = clickableLayers();
  if (!layers.length) return;

  const { x, y } = event.point;
  const hits = map.queryRenderedFeatures(
    [
      [x - CLICK_RADIUS_PX, y - CLICK_RADIUS_PX],
      [x + CLICK_RADIUS_PX, y + CLICK_RADIUS_PX],
    ],
    { layers },
  );
  if (!hits.length) return;

  // A box this size often clips the same outline more than once; keep the first
  // hit per layer, with the LIA glacier first.
  const seen = new Set();
  const sections = [];
  for (const hit of hits) {
    if (seen.has(hit.layer.id)) continue;
    seen.add(hit.layer.id);
    if (hit.layer.id === LIA_OUTLINE_FILL) sections.unshift(liaOutlineRow(hit));
    else sections.push(inventoryRow(hit));
  }

  const content = document.createDocumentFragment();
  sections.forEach((section, i) => {
    if (i > 0) content.append(document.createElement("hr"));
    content.append(...section);
  });
  new maplibregl.Popup().setLngLat(event.lngLat).setDOMContent(content).addTo(map);
  countEvent(seen.has(LIA_OUTLINE_FILL) ? "popup/lia-outline" : "popup/inventory");
});
