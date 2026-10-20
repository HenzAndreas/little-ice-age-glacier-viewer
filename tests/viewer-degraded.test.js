/*
 * The page when the layer manifest cannot be read. Its own file because the map
 * is a module singleton, and `node --test` gives each file its own process.
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { installBrowser, load, REPO, settle } from "./helpers/browser.js";

test("a missing manifest costs only the rasters", async () => {
  const page = installBrowser({
    // data/lia-layers.json is not served, so its fetch answers 404.
    files: { "data/inventories.json": path.join(REPO, "data", "inventories.json") },
  });
  const { el } = page;

  await load("js/app.js");
  await settle();
  page.map.fire("style.load");
  await settle();

  assert.equal(el("raster-controls").hidden, true, "dead sliders are hidden, not left behind");
  assert.match(el("status").textContent, /No LIA layers/);
  assert.match(el("status").textContent, /still work/);

  // Everything with no bearing on the rasters is untouched.
  assert.equal(el("inventories").children.length, 1);
  assert.equal(el("inventories-section").hidden, false);

  page.el("hillshade").checked = true;
  page.el("hillshade").dispatchEvent(new page.window.Event("change"));
  await settle();
  assert.ok(page.map.getLayer("hillshade"), "the hillshade still works");
});
