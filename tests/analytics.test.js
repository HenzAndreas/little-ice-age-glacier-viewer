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
  return { page, sent, analytics };
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

test("analytics: 3D is reported whatever switched it, and the mode the reader left in", async () => {
  const { sent, analytics } = await load();

  analytics.noteThreeD(true, "tour");
  analytics.noteThreeD(true, "button"); // no change, no event
  analytics.noteThreeD(false, "button");
  analytics.noteThreeD(true, "url");

  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new window.Event("visibilitychange"));
  // Only once per page load, however often the tab is hidden.
  document.dispatchEvent(new window.Event("visibilitychange"));
  window.dispatchEvent(new window.Event("pagehide"));

  assert.deepEqual(sent, ["3d/on/tour", "3d/off/button", "3d/on/url", "leave/3d", "3d/time/under-1min"]);
});

test("analytics: a reader who never used 3D leaves in 2D, with no 3D time", async () => {
  const { sent } = await load();
  window.dispatchEvent(new window.Event("pagehide"));
  assert.deepEqual(sent, ["leave/2d"]);
});

test("analytics: events before GoatCounter has loaded are sent once it is there", async () => {
  installBrowser();
  delete window.goatcounter;
  const analytics = await freshImport("js/analytics.js");
  analytics.noteThreeD(true, "url");
  const sent = [];
  window.goatcounter = { count: (event) => sent.push(event.path) };
  analytics.countEvent("tour/open");
  assert.deepEqual(sent, ["3d/on/url", "tour/open"]);
});

test("analytics: 3D time bins", async () => {
  installBrowser();
  const { threeDTimeBin } = await freshImport("js/analytics.js");
  assert.deepEqual(
    [30e3, 2 * 60e3, 10 * 60e3, 60 * 60e3].map(threeDTimeBin),
    ["under-1min", "1-5min", "5-15min", "over-15min"],
  );
});
