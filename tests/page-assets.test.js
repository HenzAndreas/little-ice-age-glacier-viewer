/*
 * Every file index.html asks the browser for, and whether the deploy stages it.
 *
 * deploy.yml names the directories it copies one by one, so adding one to the
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
  assert.ok(!refs.some((ref) => ref.includes("glace")), "the page has no GLACE branding asset");

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
  const workflowPath = path.join(REPO, ".github", "workflows", "deploy.yml");
  if (!fs.existsSync(workflowPath)) return;
  const workflow = fs.readFileSync(workflowPath, "utf8");
  const stage = workflow.slice(workflow.indexOf("Stage the site"), workflow.indexOf("upload-pages"));

  for (const ref of localReferences()) {
    const root = ref.split("/")[0];
    assert.match(stage, new RegExp(`\\b${root}\\b`), `deploy.yml never copies ${root}`);
  }
});
