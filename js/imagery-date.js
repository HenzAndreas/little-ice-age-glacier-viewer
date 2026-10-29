/*
 * When the satellite or aerial image under the map centre was taken, shown on
 * its own line in the map's ⓘ credits while World Imagery is the basemap.
 *
 * World Imagery is a mosaic, so there is no single year: SWISSIMAGE in
 * Switzerland, regional orthophotos in Austria, Vantor scenes elsewhere, and a
 * 15 m TerraColor composite without a date at small scales. Esri's imagery
 * metadata service says which source is drawn at a point and zoom level; one
 * `identify` request returns every level's source at once, and the entry is
 * refreshed after each move.
 *
 * MapLibre rewrites the credits line whenever a source's attribution comes or
 * goes, so the entry is appended again each time that happens rather than
 * written once. Nothing is shown when the service cannot be reached.
 */

import { WORLD_IMAGERY_METADATA } from "./config.js";

const SERVICE_NAME = /^World_Imagery_Metadata_\d{4}_r\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// World Imagery's deepest level, matching `maxzoom` of its source in js/map.js.
const MAX_LEVEL = 19;
const SETTLE_MS = 400;

/* One metadata service per World Imagery release; the newest describes the
 * tiles served today. Looked up once, on first use. */
let serviceUrl = null;
function latestService() {
  serviceUrl ??= fetch(`${WORLD_IMAGERY_METADATA}?f=json`)
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`${response.status}`))))
    .then(({ services = [] }) => {
      const name = services.map((service) => service.name).filter((n) => SERVICE_NAME.test(n)).sort().at(-1);
      if (!name) throw new Error("no World Imagery metadata service");
      return `${WORLD_IMAGERY_METADATA}/${name}/MapServer`;
    })
    .catch((error) => {
      serviceUrl = null; // try again on the next move
      throw error;
    });
  return serviceUrl;
}

/* 20230820 -> "20 Aug 2023". */
export function formatSourceDate(value) {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/* The source drawn at `level` among the identify results: each one lists the
 * levels it is drawn at, and where two overlap the higher DrawOrder is on top. */
export function sourceAtLevel(results, level) {
  let best = null;
  for (const { attributes: a } of results ?? []) {
    if (!a || level < a.MinMapLevel || level > a.MaxMapLevel) continue;
    if (!best || a.DrawOrder > best.DrawOrder) best = a;
  }
  return best;
}

export function describeSource(source) {
  if (!source) return null;
  const name = source.SRC_DESC || source.NICE_NAME || "unknown source";
  const credit = source.NICE_DESC && source.NICE_DESC !== name ? ` (${source.NICE_DESC})` : "";
  const date = formatSourceDate(source.SRC_DATE);
  return date
    ? `Imagery here: ${name}${credit}, taken ${date}`
    : `Imagery here: ${name}${credit}, a composite without a single date; zoom in for dated imagery`;
}

/* `isActive` says whether World Imagery is the basemap; call the returned
 * `refresh` when that changes. */
export function initImageryDate(map, { isActive }) {
  const entry = document.createElement("span");
  entry.className = "imagery-date";
  let text = "";
  let timer = null;
  let controller = null;

  function place() {
    const inner = map.getContainer()?.querySelector(".maplibregl-ctrl-attrib-inner");
    if (!inner) return;
    if (!text || !isActive()) {
      entry.remove();
      return;
    }
    // On a line of its own (style.css), as it is the one entry people look for.
    entry.textContent = text;
    if (entry.parentNode !== inner) inner.append(entry);
  }

  let observed = null;
  function observe() {
    const inner = map.getContainer()?.querySelector(".maplibregl-ctrl-attrib-inner");
    if (!inner || inner === observed || typeof MutationObserver !== "function") return;
    observed = inner;
    new MutationObserver(() => {
      if (text && isActive() && entry.parentNode !== inner) place();
    }).observe(inner, { childList: true });
  }

  async function lookup() {
    if (!isActive()) return;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    const { lng, lat } = map.getCenter();
    // A 256 px raster is drawn one level deeper than the map's zoom, rounded.
    const level = Math.min(MAX_LEVEL, Math.round(map.getZoom() + 1));
    try {
      const base = await latestService();
      const point = `${lng.toFixed(5)},${lat.toFixed(5)}`;
      const query = new URLSearchParams({
        geometry: point,
        geometryType: "esriGeometryPoint",
        sr: "4326",
        layers: "all",
        tolerance: "0",
        mapExtent: `${point},${point}`,
        imageDisplay: "1,1,96",
        returnGeometry: "false",
        f: "json",
      });
      const response = await fetch(`${base}/identify?${query}`, { signal });
      if (!response.ok) throw new Error(`${response.status}`);
      const { results } = await response.json();
      text = describeSource(sourceAtLevel(results, level)) ?? "";
    } catch (error) {
      if (signal.aborted) return;
      text = "";
    }
    observe();
    place();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(lookup, SETTLE_MS);
  }

  map.on("moveend", schedule);
  return function refresh() {
    observe();
    place();
    if (isActive()) schedule();
  };
}
