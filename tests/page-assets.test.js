/*
 * Every file index.html asks the browser for, and whether the deploy stages it.
 *
 * pages.yml names the directories it copies one by one, so adding one to the
 * repository is not enough to publish it — and a missing icon or wordmark shows
 * up as a plain-looking page rather than as any error a DOM test would catch.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { JSDOM } from "jsdom";

import { REPO } from "./helpers/browser.js";

/* Every local src/href on the page. The absolute ones are the CDN libraries,
 * which are somebody else's to keep alive. */
function localReferences() {
  const dom = new JSDOM(fs.readFileSync(path.join(REPO, "index.html"), "utf8"));
  const refs = new Set();
  for (const el of dom.window.document.querySelectorAll("[src], [href]")) {
    const value = el.getAttribute("src") ?? el.getAttribute("href");
    if (value && !/^[a-z]+:|^\/\//i.test(value)) refs.add(value);
  }
  return [...refs];
}

test("every file the page references is in the repository", () => {
  const refs = localReferences();
  // A guard on the guard: a selector that matched nothing would pass silently.
  assert.ok(refs.includes("favicon/favicon.ico"), "the favicon is among the references");

  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(REPO, ref)), `index.html asks for ${ref}, which is missing`);
  }
});

/* The stylesheet is a <link> and the script an import-map entry, so the two
 * pins of one library are in different syntaxes and would drift silently. */
test("every pin of maplibre-gl on the page names one version", () => {
  const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
  const versions = new Set([...html.matchAll(/maplibre-gl@([^/]+)\//g)].map((m) => m[1]));
  assert.equal(versions.size, 1, `index.html pins maplibre-gl at ${[...versions].join(" and ")}`);
});

test("the deploy stages every directory the page reads from", () => {
  const workflow = fs.readFileSync(path.join(REPO, ".github", "workflows", "pages.yml"), "utf8");
  const stage = workflow.slice(
    workflow.indexOf("Assemble the site"),
    workflow.indexOf("Fetch the data archives"),
  );

  for (const ref of localReferences()) {
    const root = ref.split("/")[0];
    assert.match(stage, new RegExp(`\\b${root}\\b`), `pages.yml never copies ${root}`);
  }
});

/* Safari before 16.4 has neither import maps nor OffscreenCanvas, and fails
 * inside the modules with nothing on screen. The guard is a classic script, so
 * it must come before the import map and the modules it reports on. */
test("an old browser is told why the map is missing", () => {
  const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
  const guard = html.indexOf('HTMLScriptElement.supports("importmap")');
  assert.notEqual(guard, -1, "the guard checks for import maps");
  assert.ok(html.indexOf("typeof OffscreenCanvas") > -1, "and for OffscreenCanvas");
  assert.ok(guard < html.indexOf('<script type="importmap">'));
  assert.ok(html.indexOf('id="status"') < guard, "after the status line it writes to");
});
