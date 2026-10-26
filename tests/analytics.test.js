/*
 * The anonymous usage events: what a click on a control reports, and that a
 * missing GoatCounter script (blocked, or not loaded yet) changes nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { freshImport, installBrowser } from "./helpers/browser.js";

const load = async () => {
  const page = installBrowser();
  const sent = [];
  window.goatcounter = { count: (event) => sent.push(event.path) };
  const analytics = await freshImport("js/analytics.js");
  analytics.initAnalytics();
  return { page, sent };
};

test("analytics: controls report the state they were put in", async () => {
  const { page, sent } = await load();

  page.el("period").dataset.value = "today";
  page.el("period").click();
  page.el("tour-open").click();

  const outlines = page.el("lia-outlines");
  outlines.checked = false;
  outlines.dispatchEvent(new window.Event("change", { bubbles: true }));

  // A section counts when it is opened, not when it is closed again.
  const credits = page.el("credits-toggle");
  credits.setAttribute("aria-expanded", "true");
  credits.click();
  credits.setAttribute("aria-expanded", "false");
  credits.click();

  assert.deepEqual(sent, ["period/today", "tour/open", "outlines/off", "section/credits"]);
});

test("analytics: links off the page are counted, the map canvas is not", async () => {
  const { page, sent } = await load();
  const paper = document.querySelector('#credits a[href^="https://doi.org/10.5194/tc-19-5913"]');
  paper.addEventListener("click", (event) => event.preventDefault());
  paper.click();
  page.el("map").click();
  assert.deepEqual(sent, ["link/doi.org/10.5194/tc-19-5913-2025"]);
});

test("analytics: without the GoatCounter script nothing is sent and nothing throws", async () => {
  installBrowser();
  delete window.goatcounter;
  const analytics = await freshImport("js/analytics.js");
  analytics.initAnalytics();
  analytics.countEvent("anything");
  document.getElementById("period").click();
});
