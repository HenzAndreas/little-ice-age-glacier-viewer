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
const HINT_MS = 6000;

/* A phone or tablet: no mouse to describe, so the navigation step only names
 * the finger gestures. */
const touchOnly = () => window.matchMedia("(hover: none) and (pointer: coarse)").matches;

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
      "Flip this switch to compare the Little Ice Age glaciers with today's landscape.",
  },
  {
    target: ".maplibregl-ctrl-3d",
    title: "View the glaciers in 3D",
    text:
      "Press 3D to tilt the map. See how the Little Ice Age glaciers filled the valleys.",
    action: {
      label: "Show me Aletsch in 3D",
      run: async () => {
        await setThreeD(true, { tilt: false, via: "tour" });
        map.flyTo({ ...SHOWCASE_VIEW, duration: 3500, essential: true });
      },
    },
  },
  {
    target: ".maplibregl-ctrl-top-right .maplibregl-ctrl-group",
    title: "Moving around",
    text: () =>
      touchOnly()
        ? "Pinch with two fingers to zoom. To tilt, drag two fingers up or down; to rotate, " +
          "twist them. The compass resets the view to north."
        : "Zoom with the buttons or the scroll wheel. To rotate and tilt, drag with the right " +
          "mouse button or hold Ctrl while dragging. The compass resets the view to north.",
  },
  {
    target: "#raster-controls",
    title: "Ice thickness",
    text:
      "The colours show the reconstructed ice thickness. " +
      "Use the opacity slider to see the terrain and imagery underneath.",
  },
  {
    target: "#lia-outlines-row",
    title: "Glacier outlines and details",
    text:
      "This box turns the outlines on and off. Click inside any glacier to see its ID, equilibrium-line altitude (ELA), area, volume " +
      "and length.",
  },
  {
    target: "#extras-section",
    title: "Map options",
    text: "Choose satellite imagery or a shaded relief, adjust the hillshade and toggle place names.",
  },
  {
    target: "#tour-open",
    title: "That's it",
    text: "You can replay this tour at any time with this question mark button.",
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
  hideHint();
  openPanel();
  steps = STEPS.filter((step) => !step.target || visible(document.querySelector(step.target)));
  index = 0;
  root = h(
    "div",
    { id: "tour", role: "dialog", "aria-modal": "true", "aria-labelledby": "tour-title" },
    h("div", { class: "tour-spot", "aria-hidden": "true" }),
    h("div", { class: "tour-card", tabIndex: -1 }),
  );
  /* A click anywhere outside the card leaves the tour, like "Skip tour". Only
   * clicks on the overlay itself count: the spotlight lets clicks through, and
   * a card button has often been replaced by the next step before its click
   * bubbles up here, so asking whether the target is inside the card fails. */
  root.addEventListener("click", (event) => {
    if (event.target === root) skipTour();
  });
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

/* Leaving before the end: close, then point at the "?" for a few seconds so
 * the reader knows where the tour went. The hint goes at the next tap or
 * click anywhere, or by itself. */
function skipTour() {
  closeTour();
  showHint();
}

let hint = null;

function hideHint() {
  if (!hint) return;
  clearTimeout(hint.timer);
  document.removeEventListener("pointerdown", hideHint, true);
  hint.node.remove();
  hint = null;
}

function showHint() {
  hideHint();
  const button = document.getElementById("tour-open");
  if (!visible(button)) return;
  const node = h("div", { id: "tour-hint", role: "status" }, "Open the tour again here, if you need it.");
  document.body.append(node);
  const r = button.getBoundingClientRect();
  const left = Math.min(
    Math.max(MARGIN_PX, r.left + r.width / 2 - node.offsetWidth / 2),
    window.innerWidth - node.offsetWidth - MARGIN_PX,
  );
  node.style.left = `${left}px`;
  node.style.top = `${r.bottom + 10}px`;
  // The arrow points at the button wherever the box had to be clamped to.
  node.style.setProperty("--arrow-x", `${r.left + r.width / 2 - left}px`);
  hint = { node, timer: setTimeout(hideHint, HINT_MS) };
  document.addEventListener("pointerdown", hideHint, true);
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
  if (event.key === "Escape") skipTour();
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
    h("p", { class: "tour-text" }, typeof step.text === "function" ? step.text() : step.text),
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
      last ? null : h("button", { type: "button", class: "tour-skip", onclick: skipTour }, "Skip tour"),
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
