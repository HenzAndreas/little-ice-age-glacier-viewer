/*
 * The layer manifest, data/lia-layers.json: which records the page will draw,
 * and where it looks for their archives. The committed manifest is checked
 * too, so a hand edit that breaks it fails here rather than on the live page.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { captureWarnings, installBrowser, load, REPO } from "./helpers/browser.js";

installBrowser();
const { manifestLayers } = await load("js/rasters.js");

const layer = (overrides = {}) => ({
  id: "lia-thickness",
  title: "Ice thickness",
  url: "thickness.pmtiles",
  minZoom: 0,
  maxZoom: 12,
  vmin: 0,
  vmax: 690,
  units: "m",
  colors: ["#f7fbff", "#08306b"],
  ...overrides,
});

test("the committed manifest has a drawable thickness layer", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, "data", "lia-layers.json"), "utf8"));
  const [first] = manifestLayers(manifest, "tiles");
  assert.equal(first.id, "lia-thickness", "the id the thickness build script looks up");
  assert.equal(first.url, "tiles/Alps-wide_LIA_glacier_thickness_soft.pmtiles");
  assert.equal(first.units, "m");
});

test("a bare archive name is resolved under tilesBase, an absolute URL is kept", () => {
  const [bare, absolute, rooted] = manifestLayers(
    {
      layers: [
        layer(),
        layer({ id: "b", url: "https://data.example/b.pmtiles" }),
        layer({ id: "c", url: "/c.pmtiles" }),
      ],
    },
    "https://tiles.example/lia",
  );
  assert.equal(bare.url, "https://tiles.example/lia/thickness.pmtiles");
  assert.equal(absolute.url, "https://data.example/b.pmtiles");
  assert.equal(rooted.url, "/c.pmtiles");
});

test("the archive suffix is added to bare names only", () => {
  const [bare, absolute] = manifestLayers(
    { layers: [layer(), layer({ id: "b", url: "https://data.example/b.pmtiles" })] },
    "tiles",
    ".png",
  );
  assert.equal(bare.url, "tiles/thickness.pmtiles.png");
  assert.equal(absolute.url, "https://data.example/b.pmtiles");
});

test("a record the page cannot draw is dropped with a warning", async () => {
  const warnings = await captureWarnings(() => {
    const layers = manifestLayers({
      layers: [
        layer({ id: "no-url", url: "" }),
        layer({ id: "zooms", minZoom: 13, maxZoom: 12 }),
        layer({ id: "stretch", vmin: 5, vmax: 5 }),
        layer({ id: "ramp", colors: ["#fff"] }),
        layer({ id: "text", vmax: "690" }),
        null,
        layer({ id: "good" }),
      ],
    });
    assert.deepEqual(layers.map((entry) => entry.id), ["good"]);
  });
  assert.equal(warnings.length, 6);
});

test("a manifest with nothing drawable is refused", async () => {
  await captureWarnings(() => {
    for (const manifest of [null, {}, { layers: [] }, { layers: [layer({ colors: [] })] }]) {
      assert.throws(() => manifestLayers(manifest), /no drawable layer/, JSON.stringify(manifest));
    }
  });
});
