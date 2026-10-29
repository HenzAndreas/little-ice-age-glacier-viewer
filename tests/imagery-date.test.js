/*
 * The imagery capture date in the map credits: which Esri source is drawn at a
 * zoom level, how its date reads, and that the entry survives MapLibre
 * rewriting the credits line.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { freshImport, installBrowser, settle } from "./helpers/browser.js";

const ROOT = "https://metadata.maptiles.arcgis.com/arcgis/rest/services";

// Trimmed from a real identify answer at the Great Aletsch Glacier.
const SWISSIMAGE = {
  SRC_DATE: 20230820,
  SRC_DESC: "SWISSIMAGE 10 cm",
  NICE_DESC: "©swisstopo, ©Planet",
  MinMapLevel: 12,
  MaxMapLevel: 19,
  DrawOrder: 100,
};
const TERRACOLOR = {
  SRC_DATE: null,
  SRC_DESC: "TerraColor NextGen",
  NICE_DESC: "Earthstar Geographics",
  MinMapLevel: 0,
  MaxMapLevel: 11,
  DrawOrder: 70,
};
const VANTOR = { ...SWISSIMAGE, SRC_DESC: "WV03", NICE_DESC: "Vantor", SRC_DATE: 20231002, DrawOrder: 80 };
const RESULTS = [SWISSIMAGE, VANTOR, TERRACOLOR].map((attributes) => ({ attributes }));

test("imagery date: the source drawn at a level, and how it reads", async () => {
  installBrowser();
  const { describeSource, formatSourceDate, sourceAtLevel } = await freshImport("js/imagery-date.js");

  assert.equal(formatSourceDate(20230820), "20 Aug 2023");
  assert.equal(formatSourceDate(null), null);
  // Overlapping sources: the higher DrawOrder is the one on top.
  assert.equal(sourceAtLevel(RESULTS, 14), SWISSIMAGE);
  assert.equal(sourceAtLevel(RESULTS, 7), TERRACOLOR);
  assert.equal(sourceAtLevel([], 7), null);

  assert.equal(
    describeSource(SWISSIMAGE),
    "Imagery here: SWISSIMAGE 10 cm (©swisstopo, ©Planet), taken 20 Aug 2023",
  );
  assert.match(describeSource(TERRACOLOR), /TerraColor NextGen .*without a single date/);
});

function fakeMap(zoom) {
  const handlers = {};
  return {
    getContainer: () => document.getElementById("map"),
    getCenter: () => ({ lng: 8.03, lat: 46.45 }),
    getZoom: () => zoom,
    on: (event, fn) => (handlers[event] ??= []).push(fn),
    fire: (event) => (handlers[event] ?? []).forEach((fn) => fn()),
  };
}

test("imagery date: appended to the credits and kept there when they are rewritten", async () => {
  const page = installBrowser();
  globalThis.MutationObserver = page.window.MutationObserver;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    const body = String(url).startsWith(`${ROOT}?`)
      ? { services: [{ name: "World_Imagery_Metadata_2026_r07" }, { name: "World_Imagery_Metadata_2026_r09" }] }
      : { results: RESULTS };
    return { ok: true, json: async () => body };
  };

  const inner = document.createElement("div");
  inner.className = "maplibregl-ctrl-attrib-inner";
  inner.innerHTML = '<a href="https://maplibre.org">MapLibre</a>';
  page.el("map").append(inner);

  let active = true;
  const { initImageryDate } = await freshImport("js/imagery-date.js");
  const map = fakeMap(13);
  const refresh = initImageryDate(map, { isActive: () => active });
  refresh();
  await new Promise((resolve) => setTimeout(resolve, 450));
  await settle();

  assert.ok(requests.at(-1).startsWith(`${ROOT}/World_Imagery_Metadata_2026_r09/MapServer/identify?`));
  assert.equal(inner.textContent, "MapLibreImagery here: SWISSIMAGE 10 cm (©swisstopo, ©Planet), taken 20 Aug 2023");

  // MapLibre replaces the whole line when a source's credit arrives.
  inner.innerHTML = '<a href="https://maplibre.org">MapLibre</a> | © Esri';
  await settle();
  assert.match(inner.textContent, /© EsriImagery here: SWISSIMAGE/);

  // Another basemap: the entry goes.
  active = false;
  refresh();
  assert.equal(inner.textContent, "MapLibre | © Esri");
  delete globalThis.MutationObserver;
});

test("imagery date: nothing is shown when the metadata service fails", async () => {
  const page = installBrowser();
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const inner = document.createElement("div");
  inner.className = "maplibregl-ctrl-attrib-inner";
  inner.textContent = "MapLibre";
  page.el("map").append(inner);

  const { initImageryDate } = await freshImport("js/imagery-date.js");
  initImageryDate(fakeMap(13), { isActive: () => true })();
  await new Promise((resolve) => setTimeout(resolve, 450));
  await settle();
  assert.equal(inner.textContent, "MapLibre");
});
