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

/* Send one event. `name` becomes the event's path in the dashboard. */
export function countEvent(name) {
  try {
    window.goatcounter?.count?.({ path: name, title: name, event: true });
  } catch {
    // Statistics must never break the page.
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
    if (button.classList.contains("maplibregl-ctrl-3d")) return "map/3d-toggle";
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
}
