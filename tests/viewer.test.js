/*
 * End-to-end smoke test of the page against a fake MapLibre.
 *
 * The modules hold state at module scope and the map is a singleton, so this is
 * one ordered scenario rather than independent cases: the page boots, controls
 * are used while the basemap is still streaming, the style arrives, and the
 * layers are exercised from there. Subtests are awaited in order.
 */

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { captureWarnings, installBrowser, load, REPO, settle } from "./helpers/browser.js";

const FILES = {
  "data/lia-layers.json": path.join(REPO, "data", "lia-layers.json"),
  "data/inventories.json": path.join(REPO, "data", "inventories.json"),
};

const THICKNESS = "lia-thickness";
const visible = (map, id) => map.getLayer(id)?.layout?.visibility === "visible";

test("the viewer", async (t) => {
  const page = installBrowser({ files: FILES });
  const { el, change, input } = page;
  // A returning visitor: the tour is opened by hand below rather than by its timer.
  page.window.localStorage.setItem("lia-viewer-tour-seen", "1");

  await load("js/app.js");
  const { map } = page;
  await settle();

  await t.test("a wide viewport opens with the panel expanded", async () => {
    const collapsed = () => el("panel").classList.contains("collapsed");
    const chevron = el("panel-toggle").querySelector(".chevron");
    assert.equal(collapsed(), false);
    assert.equal(el("panel-toggle").getAttribute("aria-expanded"), "true");
    assert.equal(chevron.classList.contains("closed"), false, "an open panel shows the chevron");

    el("panel-toggle").click();
    assert.equal(collapsed(), true, "and can still be collapsed by hand");
    assert.equal(el("panel-toggle").getAttribute("aria-expanded"), "false");
    assert.ok(chevron.classList.contains("closed"), "a collapsed panel shows the plus");

    el("panel-toggle").click();
    assert.equal(collapsed(), false);
  });

  await t.test("rotating onto a narrow screen collapses it again", async () => {
    page.setNarrow(true);
    assert.ok(el("panel").classList.contains("collapsed"), "the new width's default wins");
    page.setNarrow(false);
    assert.ok(el("panel").classList.contains("expanded"));
  });

  await t.test("the camera can be tilted almost to the horizon", async () => {
    assert.equal(map.options.maxPitch, 85);
  });

  await t.test("the style asks for a globe that flattens as you zoom in", async () => {
    assert.deepEqual(map.options.style.projection, { type: "globe" });
  });

  await t.test("the sky comes out once the globe no longer fills the viewport", async () => {
    // jsdom lays nothing out, so the map's box is given a size by hand.
    Object.defineProperty(el("map"), "clientWidth", { value: 1600, configurable: true });
    Object.defineProperty(el("map"), "clientHeight", { value: 1000, configurable: true });
    map.zoom = 1;
    map.fire("move");
    assert.ok(el("map").classList.contains("sky"), "the halo and stars are painted");
    map.zoom = 10;
    map.fire("move");
    assert.equal(el("map").classList.contains("sky"), false, "and not over a glacier");
  });

  await t.test("controls answer before the style has loaded", async () => {
    change(el("basemap"), false);
    await settle();
    assert.equal(el("hillshade").checked, true, "the hillshade is on by default");
    assert.equal(el("hillshade-strength-row").hidden, false);
    assert.ok(
      !map.calls.some((call) => call.startsWith("+")),
      `nothing added to the map yet, got: ${map.calls.join(", ")}`,
    );
  });

  await t.test("the defaults and early ticks are honoured when the style arrives", async () => {
    map.fire("style.load");
    await settle();

    assert.ok(visible(map, "hillshade"), "hillshade on");
    assert.equal(map.getLayer("hillshade").source, "terrain-lia", "shading the LIA surface");
    assert.ok(visible(map, "world-imagery"), "World Imagery is the default basemap");
    assert.ok(visible(map, THICKNESS), "the thickness is shown");
    assert.ok(map.getLayer("lia-outline-line"), "the outlines are on");
    assert.equal(map.getLayer("places").layout.visibility, "none", "basemap labels hidden");

    map.settle();
    await settle();
    assert.equal(el("status").hidden, true, "loading messages cleared");
  });

  await t.test("the thickness comes from the manifest, under tilesBase", async () => {
    const source = map.getSource(THICKNESS);
    assert.equal(source.url, "pmtiles://tiles/Alps-wide_LIA_glacier_thickness_soft.pmtiles");
    assert.equal(source.maxzoom, 12);
    assert.equal(map.getLayer(THICKNESS).paint["raster-resampling"], "linear");
    assert.equal(
      map.getSource("lia-outlines").url,
      "pmtiles://tiles/Alps-wide_LIA_outlines.pmtiles",
    );
  });

  await t.test("the panel names the layer without any GLACE leftovers", async () => {
    assert.equal(el("raster-title").textContent, "Ice thickness");
    assert.equal(el("legend-min").textContent, "0 m");
    assert.equal(el("legend-max").textContent, "690 m");
    assert.match(el("legend-bar").style.background, /linear-gradient/);
    for (const id of ["product", "quantity", "layer-info", "legend-credit"]) {
      assert.equal(el(id), null, `#${id} is gone`);
    }
    assert.doesNotMatch(el("panel").textContent, /Product|composite|weighted median/i);
  });

  await t.test("opacity applies to the thickness", async () => {
    input(el("opacity"), "40");
    await settle();
    assert.equal(map.getLayer(THICKNESS).paint["raster-opacity"], 0.4);
    assert.equal(el("opacity-value").textContent, "40%");
  });

  await t.test("the glacier-state switch moves the page to today and back", async () => {
    el("period").click();
    await settle();
    assert.equal(el("period").getAttribute("aria-checked"), "true", "Today");
    assert.equal(el("lia-controls").hidden, true);
    assert.equal(visible(map, THICKNESS), false, "no thickness over today's terrain");
    assert.equal(map.getLayer("hillshade").source, "terrain-online");
    assert.ok(map.getLayer("lia-outline-line"), "the outlines stay to compare against");

    el("period").click();
    await settle();
    assert.equal(el("lia-controls").hidden, false);
    assert.ok(visible(map, THICKNESS));
    assert.equal(map.getLayer(THICKNESS).paint["raster-opacity"], 0.4, "the opacity is kept");
    assert.equal(map.getLayer("hillshade").source, "terrain-lia");
  });

  await t.test("the map options start collapsed, behind a plus", async () => {
    const chevron = el("extras-toggle").querySelector(".chevron");
    assert.equal(el("extras").hidden, true);
    assert.ok(chevron.classList.contains("closed"));
    assert.ok(el("extras").contains(el("hillshade-row")));
    assert.ok(el("extras").contains(el("basemap-style")));

    el("extras-toggle").click();
    assert.equal(el("extras").hidden, false);
    assert.equal(el("extras-toggle").getAttribute("aria-expanded"), "true");
    assert.equal(chevron.classList.contains("closed"), false, "an open section shows the chevron");
  });

  await t.test("the credits sit below the map options and name every source", async () => {
    assert.ok(
      el("extras-section").compareDocumentPosition(el("credits-section")) &
        page.window.Node.DOCUMENT_POSITION_FOLLOWING,
    );
    assert.equal(el("credits").hidden, true, "collapsed until asked for");
    el("credits-toggle").click();
    assert.equal(el("credits").hidden, false);

    const text = el("credits").textContent.replace(/\s+/g, " ");
    for (const phrase of [
      "Henz et al. (2025)",
      "Reinthaler and Paul (2025)",
      "CC BY 4.0",
      "Luis Q. Gentner's GLACE viewer",
      "Claude (Anthropic)",
      "Esri",
      "OpenStreetMap",
      "Mapterhorn",
      "non-commercial",
    ]) {
      assert.ok(text.includes(phrase), `credits mention ${phrase}`);
    }
    const links = [...el("credits").querySelectorAll("a")].map((a) => a.href);
    assert.ok(links.includes("https://doi.org/10.5281/zenodo.17608701"), "the raw data");
    assert.ok(links.includes("https://doi.org/10.5194/tc-19-5913-2025"), "the paper");
  });

  await t.test("the basemap choice is World Imagery or a shaded relief", async () => {
    const buttons = [...el("basemap-style").children];
    assert.deepEqual(buttons.map((button) => button.textContent), ["World Imagery", "Hillshade"]);
    assert.equal(buttons[0].getAttribute("aria-checked"), "true");

    buttons[1].click();
    await settle();
    assert.ok(visible(map, "relief-hillshade"));
    assert.equal(visible(map, "world-imagery"), false);
    assert.equal(map.getLayer("earth").layout.visibility, "none", "the vector fills stay off");

    buttons[0].click();
    await settle();
    assert.ok(visible(map, "world-imagery"));
    assert.equal(visible(map, "relief-hillshade"), false);
  });

  await t.test("data under the hillshade, outlines above it, labels on top", async () => {
    assert.ok(map.indexOf("world-imagery") < map.indexOf(THICKNESS));
    assert.ok(map.indexOf(THICKNESS) < map.indexOf("hillshade"));
    assert.ok(map.indexOf("hillshade") < map.indexOf("lia-outline-casing"));
    assert.ok(map.indexOf("lia-outline-line") < map.indexOf("places"));
  });

  await t.test("the strength slider drives the shadow alpha", async () => {
    input(el("hillshade-strength"), "20");
    await settle();
    assert.equal(map.getLayer("hillshade").paint["hillshade-shadow-color"], "rgba(0, 0, 0, 0.200)");
    assert.equal(el("hillshade-strength-value").textContent, "20%");
  });

  await t.test("3D tilts the camera and drapes the map over the LIA terrain", async () => {
    const threeD = page.control(".maplibregl-ctrl-3d");
    assert.equal(threeD.textContent, "3D", "the button names what the next press does");

    threeD.click();
    await settle();
    assert.deepEqual(map.getTerrain(), { source: "terrain-lia", exaggeration: 1 });
    assert.equal(map.pitch, 60, "enabling 3D slants the view");
    assert.equal(threeD.textContent, "2D");

    threeD.click();
    await settle();
    assert.equal(map.getTerrain(), null);
    assert.equal(map.pitch, 0, "disabling reverts to the overhead view");
  });

  await t.test("unticking the hillshade hides it rather than tearing it down", async () => {
    change(el("hillshade"), false);
    await settle();
    assert.equal(map.getLayer("hillshade").layout.visibility, "none");
    assert.equal(el("hillshade-strength-row").hidden, true);
    assert.ok(map.getSource("terrain-lia"), "the terrain source is kept for the next tick");
  });

  await t.test("a click inside a glacier opens its attributes", async () => {
    map.hits = [
      {
        layer: { id: "lia-outline-fill" },
        properties: {
          LIA_ID: "LIA-1234",
          ela: 2850,
          area: 81.2,
          volume: 25.1,
          Citation: "Some outline source",
        },
      },
    ];
    map.fire("click", { point: { x: 10, y: 10 }, lngLat: [8, 46] });

    const text = page.popups.at(-1).content.textContent;
    assert.ok(text.includes("LIA-1234"));
    assert.ok(text.includes("2850 m a.s.l."));
    assert.ok(text.includes("25.1 km³"));
    assert.ok(text.includes("Some outline source"));
    assert.ok(text.includes("doi:10.5194/tc-19-5913-2025"), "the final paper, not the preprint");
    assert.ok(text.includes("doi:10.5194/tc-19-753-2025"), "the outline inventory");
  });

  await t.test("markup in a feature property stays text", async () => {
    map.hits = [
      { layer: { id: "lia-outline-fill" }, properties: { LIA_ID: '<img src=x onerror="fail()">' } },
    ];
    map.fire("click", { point: { x: 10, y: 10 }, lngLat: [8, 46] });

    const { content } = page.popups.at(-1);
    const wrapper = page.window.document.createElement("div");
    wrapper.append(content);
    assert.equal(wrapper.querySelector("img"), null, "no element was parsed out of the value");
    assert.ok(wrapper.textContent.includes("<img src=x"), "the value is shown verbatim");
  });

  await t.test("the inventory list is built from the index", async () => {
    assert.equal(el("inventories-section").hidden, false);
    assert.ok(el("inv-pauletal2020"));
  });

  await t.test("a failed overlay rolls back so re-ticking retries", async () => {
    change(el("inv-pauletal2020"), true);
    await settle();
    assert.ok(map.getSource("inv-pauletal2020"));

    await captureWarnings(async () => {
      map.fire("error", { sourceId: "inv-pauletal2020", error: new Error("HTTP 404") });
      await settle();
    });
    assert.equal(map.getSource("inv-pauletal2020"), undefined);
    assert.equal(el("inv-pauletal2020").checked, false, "the box is unticked");
    assert.ok(el("status").textContent.includes("HTTP 404"));

    change(el("inv-pauletal2020"), true);
    await settle();
    assert.ok(map.getSource("inv-pauletal2020"), "the second attempt is a fresh load");
  });

  await t.test("the tour opens on the intro and can be closed", async () => {
    el("tour-open").click();
    const tour = page.window.document.getElementById("tour");
    assert.ok(tour);
    assert.match(
      tour.textContent,
      /maximum stage during the Little Ice Age \(1260 to 1860 CE\), reconstructed with a 3D glacier model/,
    );
    assert.match(tour.textContent, /skip the tour or click next/);

    // jsdom lays nothing out, so no control counts as visible and the intro is
    // the only step: its button is "Done" rather than "Next".
    tour.querySelector(".tour-next").click();
    assert.equal(page.window.document.getElementById("tour"), null);
    assert.equal(page.window.document.getElementById("tour-hint"), null, "no hint after Done");
  });

  await t.test("a click outside the card leaves the tour and points at the ?", async () => {
    const { document } = page.window;
    // jsdom lays nothing out; give every element a box so all steps and the
    // "?" count as visible.
    const original = page.window.Element.prototype.getClientRects;
    page.window.Element.prototype.getClientRects = () => [{}];
    try {
      el("tour-open").click();
      document.querySelector(".tour-card").click();
      assert.ok(document.getElementById("tour"), "a click on the card keeps it open");

      document.getElementById("tour").click();
      assert.equal(document.getElementById("tour"), null, "a click beside it closes it");
      const hint = document.getElementById("tour-hint");
      assert.match(hint.textContent, /Open the tour again here/);

      document.dispatchEvent(new page.window.Event("pointerdown"));
      assert.equal(document.getElementById("tour-hint"), null, "the next tap removes the hint");
    } finally {
      page.window.Element.prototype.getClientRects = original;
    }
  });

  await t.test("the navigation step names mouse or fingers, not both", async () => {
    const { document } = page.window;
    const original = page.window.Element.prototype.getClientRects;
    page.window.Element.prototype.getClientRects = () => [{}];
    // Nor can it scroll: the tour brings each target into view first.
    page.window.Element.prototype.scrollIntoView ??= () => {};
    // The step points at MapLibre's zoom buttons, which the fake map never builds.
    const corner = document.createElement("div");
    corner.className = "maplibregl-ctrl-top-right";
    corner.innerHTML = '<div class="maplibregl-ctrl-group"></div>';
    document.body.append(corner);
    const navigationText = () => {
      el("tour-open").click();
      while (!/Moving around/.test(document.querySelector(".tour-card").textContent)) {
        document.querySelector(".tour-next").click();
      }
      const text = document.querySelector(".tour-text").textContent;
      document.querySelector(".tour-skip").click();
      return text;
    };
    try {
      // The fake matchMedia answers every query alike: "narrow" stands in for
      // a touch-only device here.
      page.setNarrow(true);
      const touch = navigationText();
      page.setNarrow(false);
      const desktop = navigationText();
      assert.match(touch, /two fingers/);
      assert.doesNotMatch(touch, /mouse|scroll wheel/);
      assert.match(desktop, /scroll wheel/);
      assert.doesNotMatch(desktop, /fingers/);
    } finally {
      corner.remove();
      page.window.Element.prototype.getClientRects = original;
    }
  });

  await t.test("the credits link to the GLACE viewer", async () => {
    const link = [...el("credits").querySelectorAll("a")].find((a) => a.textContent === "GLACE viewer");
    assert.equal(link.href, "https://lqgentner.github.io/glace-viewer");
  });
});
