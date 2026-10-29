/*
 * Anonymous usage counts, sent to GoatCounter (no cookies, no personal data).
 *
 * Page views are counted by GoatCounter's own script in index.html. This module
 * adds named events for the controls, from one listener on the document rather
 * than a call in every handler, so the control code stays as it was. The
 * listeners run in the bubble phase, after a control's own handler, so a
 * switch or a section toggle reports the state it was just put in.
 *
 * Everything here is a no-op while the GoatCounter script is missing — blocked
 * by an ad blocker, still loading, or in the tests. GoatCounter also ignores
 * localhost, so local development is never counted.
 */

/* Events from before GoatCounter's script has loaded — a link that opens in 3D
 * reports it at startup. Kept short: a blocked script never loads. */
const pending = [];
const MAX_PENDING = 20;

/* Send one event. `name` becomes the event's path in the dashboard. */
export function countEvent(name) {
  try {
    if (typeof window.goatcounter?.count !== "function") {
      if (pending.length < MAX_PENDING) pending.push(name);
      return;
    }
    for (const queued of pending.splice(0)) send(queued);
    send(name);
  } catch {
    // Statistics must never break the page.
  }
}

function send(name) {
  window.goatcounter.count({ path: name, title: name, event: true });
}

function flushPending() {
  if (pending.length && typeof window.goatcounter?.count === "function") {
    countEvent(pending.pop());
  }
}

/* ---------- 3D ---------- */

/* Reported from setThreeD() in js/map.js, whatever switched the mesh: the 3D
 * button, the tour's Aletsch flight, or a URL that opens tilted (a shared link
 * or a reload). Counting clicks on the button alone missed the last two. */
const threeD = { on: false, since: 0, totalMs: 0, used: false };

export function noteThreeD(on, via) {
  if (on === threeD.on) return;
  const now = performance.now();
  if (threeD.on) threeD.totalMs += now - threeD.since;
  Object.assign(threeD, { on, since: now, used: threeD.used || on });
  countEvent(`3d/${on ? "on" : "off"}/${via}`);
}

/* Minutes in 3D, in a few coarse bins rather than a number per visit. */
export function threeDTimeBin(ms) {
  const minutes = ms / 60000;
  if (minutes < 1) return "under-1min";
  if (minutes < 5) return "1-5min";
  if (minutes < 15) return "5-15min";
  return "over-15min";
}

/* Once per page load, when the page is first hidden: the tab closed or left, or
 * the phone locked. Says whether the reader left in 3D and, if they used it, how
 * long they spent there. GoatCounter sends with `sendBeacon`, which survives
 * the page being closed. */
let leaveReported = false;
function reportLeave() {
  if (leaveReported) return;
  leaveReported = true;
  countEvent(`leave/${threeD.on ? "3d" : "2d"}`);
  if (threeD.used) {
    const ms = threeD.totalMs + (threeD.on ? performance.now() - threeD.since : 0);
    countEvent(`3d/time/${threeDTimeBin(ms)}`);
  }
}

/* Clicks on buttons, by id. A function gets the button after its handler ran
 * and returns the name to count, or nothing to skip the click. */
const BUTTONS = {
  period: (button) => `period/${button.dataset.value}`,
  "tour-open": () => "tour/open",
  "panel-toggle": (button) => `panel/${button.getAttribute("aria-expanded") === "true" ? "open" : "close"}`,
  "extras-toggle": (button) => (button.getAttribute("aria-expanded") === "true" ? "section/map-options" : null),
  "credits-toggle": (button) => (button.getAttribute("aria-expanded") === "true" ? "section/credits" : null),
  "inventories-toggle": (button) => (button.getAttribute("aria-expanded") === "true" ? "section/inventories" : null),
};

/* Checkboxes and sliders, by id. A slider's `change` fires once, on release. */
const INPUTS = {
  "lia-outlines": (input) => `outlines/${input.checked ? "on" : "off"}`,
  hillshade: (input) => `hillshade/${input.checked ? "on" : "off"}`,
  basemap: (input) => `labels/${input.checked ? "on" : "off"}`,
  opacity: () => "slider/opacity",
  "hillshade-strength": () => "slider/hillshade-strength",
};

function clickName(target) {
  const button = target.closest("button");
  if (button) {
    if (Object.hasOwn(BUTTONS, button.id)) return BUTTONS[button.id](button);
    if (button.closest("#basemap-style")) return `basemap/${button.dataset.value}`;
    if (button.classList.contains("tour-skip")) return "tour/skip";
    if (button.classList.contains("tour-next") && button.textContent === "Done") return "tour/done";
    return null;
  }
  // Links that leave the page: the paper, the data, the GLACE viewer, ….
  const link = target.closest("a[href]");
  if (link && link.host && link.host !== window.location.host) return `link/${link.host}${link.pathname}`;
  return null;
}

export function initAnalytics() {
  document.addEventListener("click", (event) => {
    // Text nodes and the document itself have no `closest`.
    if (typeof event.target?.closest !== "function") return;
    const name = clickName(event.target);
    if (name) countEvent(name);
  });
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input && Object.hasOwn(INPUTS, input.id ?? "")) countEvent(INPUTS[input.id](input));
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") reportLeave();
  });
  window.addEventListener("pagehide", reportLeave);
  document.querySelector("script[data-goatcounter]")?.addEventListener("load", flushPending);
}
