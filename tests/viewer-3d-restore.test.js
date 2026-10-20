/*
 * Opening a link that was copied while the map was tilted.
 *
 * Its own file because the pitch is read once, at import time, and the map is a
 * module singleton — the same reason viewer-degraded.test.js stands apart.
 * `node --test` gives each file its own process.
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { installBrowser, load, REPO, settle } from "./helpers/browser.js";

test("a pitched #hash comes back in 3D", async () => {
  const page = installBrowser({
    pitch: 55,
    files: { "data/inventories.json": path.join(REPO, "data", "inventories.json") },
  });

  await load("js/app.js");
  const { map } = page;
  await settle();
  map.fire("style.load");
  await settle();

  // The page opens on the Little Ice Age, so the mesh is the composed LIA terrain.
  assert.deepEqual(map.getTerrain(), { source: "terrain-lia", exaggeration: 1 });
  assert.equal(
    map.pitch,
    55,
    "the shared view is kept as it was, not rounded off to the button's own 60°",
  );
  assert.equal(page.control(".maplibregl-ctrl-3d").textContent, "2D");

  assert.ok(map.getSource("terrain-lia"));
});
