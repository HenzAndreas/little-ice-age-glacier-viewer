/*
 * Little Ice Age glacier viewer — startup and control wiring.
 *
 * The archives are read from wherever `tilesBase` points — site-config.js on
 * the deployed page, or `?tiles=<base-url>` from the address bar.
 *
 * Every control is wired here, before anything has loaded, and every handler
 * that touches the map waits on `styleReady` rather than being attached late.
 * A box ticked while the basemap is still streaming therefore behaves exactly
 * like one ticked afterwards — which it did not, when the wiring itself waited
 * for the map.
 */

import { initAnalytics } from "./analytics.js";
import { TERRAIN_CREDIT } from "./config.js";
import {
  map,
  setBasemap,
  setHillshade,
  setHillshadeStrength,
  setTerrainMode,
  toggleBasemapLabels,
} from "./map.js";
import { liaOutlines, loadInventories } from "./overlays.js";
import { loadRasters, setRastersShown } from "./rasters.js";
import { initTour } from "./tour.js";
import { buildSegmented, collapsible, creditButton, el } from "./ui.js";

/* The panel covers most of a phone screen, so on a narrow viewport it opens
 * collapsed to its title bar and the reader taps to open it. Wide viewports open
 * as before. Crossing the breakpoint — a rotation, usually — re-applies the
 * default for the new width rather than carrying over a choice made for a
 * different screen. The query matches the one in style.css. */
const NARROW_VIEWPORT = window.matchMedia("(max-width: 640px)");

function setPanelOpen(open) {
  // Both classes are always set, so the state is explicit on either side of the
  // breakpoint: style.css collapses a narrow panel until `expanded` appears,
  // and expands a wide one until `collapsed` does.
  el("panel").classList.toggle("expanded", open);
  el("panel").classList.toggle("collapsed", !open);
  const toggle = el("panel-toggle");
  toggle.setAttribute("aria-expanded", String(open));
  const action = open ? "Hide the controls" : "Show the controls";
  toggle.title = action;
  toggle.setAttribute("aria-label", action);
  // `closed` (a plus) marks the collapsed state, as on the section toggles.
  toggle.querySelector(".chevron").classList.toggle("closed", !open);
}

/* The glacier state the whole page follows. "Little Ice Age" puts the
 * reconstructed surface into the 3D terrain and shows the LIA layers over it;
 * "Today" is Mapterhorn's present-day terrain and the basemap alone, since a
 * thickness or LIA relief drawn over today's surface would describe a surface
 * that is not there. */
// #!!!! ADD HERE LAYERS THAT FOLLOW THE GLACIER STATE !!!!
const PERIODS = [
  {
    value: "lia",
    label: "Little Ice Age",
    note: "3D terrain, hillshade and thickness show the reconstructed LIA glaciers.",
  },
  {
    value: "today",
    label: "Today",
    note: "Present-day terrain (Mapterhorn) and basemap; the outlines show the LIA extent.",
  },
];

/* The switch is "on" when it shows today: the LIA reconstruction is where the
 * page opens, and the knob slides over to the present. */
function selectPeriod(value) {
  const period = PERIODS.find((entry) => entry.value === value);
  const lia = value === "lia";
  const toggle = el("period");
  toggle.setAttribute("aria-checked", String(!lia));
  toggle.dataset.value = value;
  toggle.title = lia ? "Switch to today's glaciers" : "Switch to the Little Ice Age glaciers";
  el("period-note").textContent = period.note;
  el("lia-controls").hidden = !lia;
  setTerrainMode(lia ? "lia" : "online");
  setRastersShown(lia);
}

function initControls() {
  el("panel-toggle").addEventListener("click", (event) => {
    setPanelOpen(event.currentTarget.getAttribute("aria-expanded") !== "true");
  });
  NARROW_VIEWPORT.addEventListener("change", (event) => setPanelOpen(!event.matches));
  setPanelOpen(!NARROW_VIEWPORT.matches);

  // Imagery first and by default: snow, ice and moraines read best on it. The
  // alternative is a light shaded relief rather than the vector map, which was
  // too dark to read the data over.
  const basemapOptions = [
    { value: "imagery", label: "World Imagery" },
    { value: "relief", label: "Hillshade" },
  ];
  const selectBasemap = (value) => {
    for (const button of el("basemap-style").children) {
      button.setAttribute("aria-checked", String(button.dataset.value === value));
    }
    setBasemap(value);
  };
  buildSegmented(el("basemap-style"), basemapOptions, selectBasemap);
  selectBasemap("imagery");

  el("hillshade-row").append(creditButton(TERRAIN_CREDIT.title, TERRAIN_CREDIT));
  el("hillshade").addEventListener("change", (event) => {
    el("hillshade-strength-row").hidden = !event.target.checked;
    setHillshade(event.target.checked);
  });
  // On by default: in the LIA state it is the shaded relief of the LIA surface.
  if (el("hillshade").checked) setHillshade(true);
  el("hillshade-strength").addEventListener("input", (event) => {
    el("hillshade-strength-value").textContent = `${event.target.value}%`;
    setHillshadeStrength(Number(event.target.value) / 100);
  });

  el("basemap").addEventListener("change", (event) => toggleBasemapLabels(event.target.checked));
  el("lia-outlines").addEventListener("change", (event) => liaOutlines.setEnabled(event.target.checked));
  collapsible("extras-toggle", "extras");
  collapsible("credits-toggle", "credits");
}

async function boot() {
  initAnalytics();
  initControls();
  el("period").addEventListener("click", () => {
    selectPeriod(el("period").dataset.value === "lia" ? "today" : "lia");
  });
  selectPeriod("lia");
  liaOutlines.setEnabled(el("lia-outlines").checked);
  // The inventory list is independent of the map and the layer manifest, so it
  // is built at once: waiting for them made the panel jump as it grew.
  loadInventories();

  initTour({ openPanel: () => setPanelOpen(true) });

  await loadRasters();
}

boot();
