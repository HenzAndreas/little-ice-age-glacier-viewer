/*
 * The intro tour: a few cards, each pointing at one control and saying what it
 * does. It opens by itself on a first visit and again from the "?" button in
 * the panel header.
 *
 * Each step names its target by selector and is skipped when the target is not
 * on the page (no 3D button without a map, for instance), so the tour never
 * points at nothing. The highlighted control sits in a cut-out of the dimmed
 * page; the card is placed beside it wherever there is room.
 */

import { map, setThreeD } from "./map.js";
import { el, h } from "./ui.js";

const SEEN_KEY = "lia-viewer-tour-seen";
const GAP_PX = 12;
const MARGIN_PX = 10;
const SPOT_PAD_PX = 6;

/* A 3D look up the Great Aletsch Glacier from its tongue, for the "Show me"
 * button on the 3D step. */
const SHOWCASE_VIEW = { center: [8.04, 46.47], zoom: 11.7, pitch: 60, bearing: 20 };

const STEPS = [
  {
    title: "Little Ice Age glaciers of the Alps",
    text:
      "This map shows the glaciers of the European Alps as they were at their maximum stage " +
      "during the Little Ice Age (1260 to 1860 CE), reconstructed with a 3D glacier model. " +
      "You can skip the tour or click next to explore how the map-viewer works.",
  },
  {
    target: "#period-row",
    title: "Then and now",
    text:
      "Flip this switch to compare the Little Ice Age glaciers with today's landscape. " +
      "The amber outlines stay on in both states, so you can see how far the ice has retreated.",
  },
  {
    target: ".maplibregl-ctrl-3d",
    title: "View the glaciers in 3D",
    text:
      "Press 3D to tilt the map. In the Little Ice Age state the terrain itself carries the " +
      "reconstructed ice surface, so the glaciers fill their valleys as they did back then.",
    action: {
      label: "Show me Aletsch in 3D",
      run: async () => {
        await setThreeD(true, { tilt: false });
        map.flyTo({ ...SHOWCASE_VIEW, duration: 3500, essential: true });
      },
    },
  },
  {
    target: ".maplibregl-ctrl-top-right .maplibregl-ctrl-group",
    title: "Moving around",
    text:
      "Zoom with the buttons or the scroll wheel. To rotate and tilt, drag with the right " +
      "mouse button or hold Ctrl while dragging; on a touch screen, use two fingers. " +
      "The compass resets the view to north.",
  },
  {
    target: "#raster-controls",
    title: "Ice thickness",
    text:
      "The colours show the reconstructed ice thickness; the scale bar gives the values. " +
      "Use the opacity slider to see the terrain and imagery underneath.",
  },
  {
    target: "#lia-outlines-row",
    title: "Glacier outlines and details",
    text:
      "Click inside any glacier to see its ID, equilibrium-line altitude (ELA), area, volume " +
      "and length. This box turns the outlines on and off.",
  },
  {
    target: "#extras-section",
    title: "Map options",
    text: "Choose satellite imagery or a plain shaded relief, adjust the hillshade and toggle place names.",
  },
  {
    target: "#tour-open",
    title: "That's it",
    text: "You can replay this tour at any time with this button.",
  },
];

let root = null;
let steps = [];
let index = 0;
let openPanel = () => {};

function visible(node) {
  return node !== null && node.getClientRects().length > 0;
}

function storageGet() {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function storageSet() {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // A private window or blocked storage: the tour simply shows again next time.
  }
}

export function startTour() {
  closeTour();
  openPanel();
  steps = STEPS.filter((step) => !step.target || visible(document.querySelector(step.target)));
  index = 0;
  root = h(
    "div",
    { id: "tour", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-title" },
    h("div", { class: "tour-spot", "aria-hidden": "true" }),
    h("div", { class: "tour-card", tabIndex: -1 }),
  );
  document.body.append(root);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", place);
  showStep();
}

export function closeTour() {
  if (!root) return;
  root.remove();
  root = null;
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", place);
  storageSet();
}

function go(delta) {
  const next = index + delta;
  if (next < 0) return;
  if (next >= steps.length) closeTour();
  else {
    index = next;
    showStep();
  }
}

function onKey(event) {
  if (event.key === "Escape") closeTour();
  else if (event.key === "ArrowRight") go(1);
  else if (event.key === "ArrowLeft") go(-1);
}

function showStep() {
  const step = steps[index];
  const last = index === steps.length - 1;
  const card = root.querySelector(".tour-card");
  // Through h() rather than replaceChildren() directly, which would print the
  // absent action button as the text "null".
  card.replaceChildren(...h("div", {},
    h("p", { class: "tour-count" }, `${index + 1} / ${steps.length}`),
    h("h2", { id: "tour-title" }, step.title),
    h("p", { class: "tour-text" }, step.text),
    step.action
      ? h(
          "button",
          {
            type: "button",
            class: "tour-action",
            onclick: () => {
              step.action.run();
              go(1);
            },
          },
          step.action.label,
        )
      : null,
    h(
      "div",
      { class: "tour-nav" },
      last ? null : h("button", { type: "button", class: "tour-skip", onclick: closeTour }, "Skip tour"),
      index > 0 ? h("button", { type: "button", onclick: () => go(-1) }, "Back") : null,
      h("button", { type: "button", class: "tour-next", onclick: () => go(1) }, last ? "Done" : "Next"),
    ),
  ).childNodes);
  const target = step.target ? document.querySelector(step.target) : null;
  // The panel scrolls, so a control near its bottom is brought into view first.
  target?.scrollIntoView({ block: "nearest" });
  place();
  card.focus({ preventScroll: true });
}

/* The spotlight is a padded box over the target whose enormous shadow is the
 * dimmed page; with no target it shrinks to nothing in the middle, and the
 * card sits centred. Otherwise the card goes to whichever side of the target
 * has room — right, left, below, above — and is clamped into the viewport. */
function place() {
  if (!root) return;
  const step = steps[index];
  const spot = root.querySelector(".tour-spot");
  const card = root.querySelector(".tour-card");
  const target = step.target ? document.querySelector(step.target) : null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;

  if (!visible(target)) {
    Object.assign(spot.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: "0px", height: "0px" });
    card.style.left = `${Math.max(MARGIN_PX, (vw - cw) / 2)}px`;
    card.style.top = `${Math.max(MARGIN_PX, (vh - ch) / 2)}px`;
    return;
  }

  const r = target.getBoundingClientRect();
  Object.assign(spot.style, {
    left: `${r.left - SPOT_PAD_PX}px`,
    top: `${r.top - SPOT_PAD_PX}px`,
    width: `${r.width + 2 * SPOT_PAD_PX}px`,
    height: `${r.height + 2 * SPOT_PAD_PX}px`,
  });

  const pad = SPOT_PAD_PX + GAP_PX;
  const candidates = [
    { left: r.right + pad, top: r.top, fits: r.right + pad + cw <= vw - MARGIN_PX },
    { left: r.left - pad - cw, top: r.top, fits: r.left - pad - cw >= MARGIN_PX },
    { left: r.left, top: r.bottom + pad, fits: r.bottom + pad + ch <= vh - MARGIN_PX },
    { left: r.left, top: r.top - pad - ch, fits: r.top - pad - ch >= MARGIN_PX },
  ];
  const choice = candidates.find((c) => c.fits) ?? candidates[2];
  const clamp = (value, max) => Math.min(Math.max(value, MARGIN_PX), Math.max(MARGIN_PX, max));
  card.style.left = `${clamp(choice.left, vw - cw - MARGIN_PX)}px`;
  card.style.top = `${clamp(choice.top, vh - ch - MARGIN_PX)}px`;
}

/* `openPanel` expands the panel first, since on a phone it starts collapsed
 * and most of the steps point inside it. The automatic start waits a moment
 * so the map controls exist and the layout has settled. */
export function initTour(options = {}) {
  openPanel = options.openPanel ?? openPanel;
  el("tour-open").addEventListener("click", startTour);
  if (storageGet() === null) setTimeout(startTour, 600);
}
