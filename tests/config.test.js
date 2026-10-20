/*
 * The settings chain: built-in defaults, then site-config.js, then the query
 * parameters. Each case imports js/config.js fresh, because it resolves the
 * chain once at module load.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { captureWarnings, freshImport, installBrowser, REPO } from "./helpers/browser.js";

const load = async (options) => {
  installBrowser(options);
  return freshImport("js/config.js");
};

test("built-in defaults", async () => {
  const config = await load();
  assert.equal(config.TILES_BASE, "tiles");
  assert.equal(config.LIA_OUTLINES_URL, "tiles/Alps-wide_LIA_outlines.pmtiles");
  assert.equal(config.INVENTORY_INDEX_URL, "data/inventories.json");
  assert.equal(config.BASEMAP_FLAVOR, "dark");
  assert.match(config.WORLD_IMAGERY_URL, /World_Imagery\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}/);
  assert.deepEqual(config.INITIAL_VIEW, { center: [8.03, 46.51], zoom: 10, minZoom: 1, maxZoom: 14 });
});

test("an empty site config changes nothing", async () => {
  const withTemplate = await load({ site: {} });
  const bare = await load();
  assert.equal(withTemplate.TILES_BASE, bare.TILES_BASE);
  assert.equal(withTemplate.BASEMAP_FLAVOR, bare.BASEMAP_FLAVOR);
  assert.deepEqual(withTemplate.INITIAL_VIEW, bare.INITIAL_VIEW);
});

test("site config repoints the archives, and everything derived follows", async () => {
  const config = await load({
    site: {
      tilesBase: "https://s3.example/lia/",
      worldImageryUrl: "https://imagery.example/{z}/{x}/{y}.jpg",
    },
  });
  // The trailing slash is trimmed, so the joins below cannot double it.
  assert.equal(config.TILES_BASE, "https://s3.example/lia");
  assert.equal(config.LIA_OUTLINES_URL, "https://s3.example/lia/Alps-wide_LIA_outlines.pmtiles");
  assert.equal(
    config.LIA_SURFACE_PATCH_URL,
    "https://s3.example/lia/Alps-wide_LIA_surface_patch.pmtiles",
  );
  assert.equal(config.WORLD_IMAGERY_URL, "https://imagery.example/{z}/{x}/{y}.jpg");
});

test("an archive suffix follows every archive name", async () => {
  const config = await load({ site: { archiveSuffix: ".png" } });
  assert.equal(config.LIA_OUTLINES_URL, "tiles/Alps-wide_LIA_outlines.pmtiles.png");
  assert.equal(config.LIA_SURFACE_PATCH_URL, "tiles/Alps-wide_LIA_surface_patch.pmtiles.png");
  assert.equal((await load()).ARCHIVE_SUFFIX, "", "and is empty by default");
});

test("a partial nested override keeps the rest of the object", async () => {
  const view = await load({ site: { initialView: { zoom: 8 } } });
  assert.equal(view.INITIAL_VIEW.zoom, 8);
  assert.deepEqual(view.INITIAL_VIEW.center, [8.03, 46.51]);
  assert.equal(view.INITIAL_VIEW.maxZoom, 14);

  const credit = await load({ site: { terrainCredit: { citation: "© Someone" } } });
  assert.equal(credit.TERRAIN_CREDIT.citation, "© Someone");
  assert.equal(credit.TERRAIN_CREDIT.title, "Mapterhorn Terrain Tiles");
  assert.equal(credit.TERRAIN_CREDIT.links.length, 2);
});

test("query parameters win over site config", async () => {
  const config = await load({
    search: "?tiles=https://other.example/x&basemap=https://other.example/b.pmtiles&flavor=dark",
    site: { tilesBase: "https://s3.example/lia", basemapFlavor: "light" },
  });
  assert.equal(config.TILES_BASE, "https://other.example/x");
  assert.equal(config.BASEMAP_URL, "https://other.example/b.pmtiles");
  assert.equal(config.BASEMAP_FLAVOR, "dark");
});

test("an empty query parameter does not blank a setting", async () => {
  const config = await load({ search: "?tiles=", site: { tilesBase: "https://s3.example/lia" } });
  assert.equal(config.TILES_BASE, "https://s3.example/lia");
});

test("deployment-only settings are not reachable from the address bar", async () => {
  const config = await load({
    search:
      "?inventoryBase=/etc&initialView=x&terrainTilejson=http://evil&worldImageryUrl=http://evil",
  });
  assert.match(config.WORLD_IMAGERY_URL, /^https:\/\/server\.arcgisonline\.com\//);
  assert.equal(config.INVENTORY_BASE, "data");
  assert.equal(config.TERRAIN_TILEJSON, "https://tiles.mapterhorn.com/tilejson.json");
  assert.deepEqual(config.INITIAL_VIEW, { center: [8.03, 46.51], zoom: 10, minZoom: 1, maxZoom: 14 });
});

test("a misspelled setting warns instead of silently doing nothing", async () => {
  const warnings = await captureWarnings(() => load({ site: { tileBase: "oops" } }));
  assert.ok(warnings.some((line) => line.includes("tileBase")));
});

test("the committed site-config.js sets only the archive path and the opening view", async () => {
  // This copy of the file is the live deployment as well as the template.
  // Anything else uncommented here would change every deployment that does not
  // replace the file, which is what the defaults are for.
  const { window } = installBrowser();
  const source = fs.readFileSync(path.join(REPO, "site-config.js"), "utf8");
  new Function("window", source)(window);
  assert.deepEqual(window.LIA_CONFIG, {
    tilesBase: "tiles",
    initialView: { center: [8.5, 46.5], zoom: 6, maxZoom: 14 },
  });
});
