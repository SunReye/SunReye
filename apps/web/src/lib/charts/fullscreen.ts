/**
 * Taking one chart full-screen, across the browsers this app actually runs in.
 *
 * Three of them disagree. Chrome and Firefox have `Element.requestFullscreen`;
 * Safari still ships the `webkit`-prefixed spelling on iPad and older desktop
 * builds; Safari on iPhone has neither for anything but a `<video>`. And under
 * Home Assistant ingress the whole app is inside a cross-origin iframe, where
 * Chrome rejects the request unless the frame carries `allow="fullscreen"` —
 * something this app does not control.
 *
 * So the button can never assume it worked. Everything here answers with a
 * value the caller can branch on rather than throwing.
 *
 * **What goes full-screen is the document element, never the chart's own card.**
 * That is not a detail. In native full screen the browser renders ONLY the
 * full-screen element's subtree, and every popup in this app — layerchart's
 * tooltip, and bits-ui's dropdown, select and popover content — is portalled to
 * `document.body`, outside any one card. Full-screening the card therefore hid
 * every tooltip and left every menu opening invisibly: the control looked dead.
 * Full-screening `<html>` keeps the whole document in the rendering tree, and
 * the card is made to fill the screen by a fixed overlay either way. The native
 * call then buys exactly one thing — the browser's own chrome goes away — and
 * losing it (iPhone, or a cross-origin ingress iframe) costs only that.
 */

/** The subset of `Element` this module touches, plus the prefixed spelling. */
export interface FullscreenCapableElement {
  requestFullscreen?: (() => Promise<void>) | undefined;
  webkitRequestFullscreen?: (() => void) | undefined;
}

/** The subset of `Document` this module touches, plus the prefixed spelling. */
export interface FullscreenCapableDocument {
  documentElement?: FullscreenCapableElement | undefined;
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: (() => Promise<void>) | undefined;
  webkitExitFullscreen?: (() => void) | undefined;
}

/**
 * What to hand the browser: the document element, never the card that asked.
 *
 * See the module comment — full-screening the card takes every body-portalled
 * popup out of the rendering tree, which is how tooltips disappeared and menus
 * opened invisibly. The card fills the screen by a fixed overlay either way, so
 * there is nothing to gain from full-screening it and a whole class of dead
 * controls to lose.
 */
export function fullscreenTarget(
  doc: FullscreenCapableDocument | null,
): FullscreenCapableElement | null {
  return doc?.documentElement ?? null;
}

/** Whether the browser will also hide its own chrome for us. */
export type FullscreenMode = "native" | "overlay";

/**
 * Whether the browser can hide its chrome for us, or we get the overlay alone.
 *
 * Checked by callability rather than by presence: a property that exists and is
 * not a function would throw inside the click handler, leaving the chart in
 * neither state.
 */
export function fullscreenMode(el: FullscreenCapableElement | null): FullscreenMode {
  if (!el) return "overlay";
  const native = typeof el.requestFullscreen === "function";
  const prefixed = typeof el.webkitRequestFullscreen === "function";
  return native || prefixed ? "native" : "overlay";
}

/** The element currently occupying the screen, under either spelling. */
export function activeFullscreenElement(doc: FullscreenCapableDocument | null): unknown {
  if (!doc) return null;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Ask for the screen. Resolves `true` when the request was accepted, `false`
 * when the browser refused it or has no such API — the caller opens the overlay
 * on `false` rather than leaving a dead button.
 */
export async function requestFullscreen(el: FullscreenCapableElement | null): Promise<boolean> {
  if (!el) return false;
  try {
    if (typeof el.requestFullscreen === "function") {
      await el.requestFullscreen();
      return true;
    }
    if (typeof el.webkitRequestFullscreen === "function") {
      el.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // A refusal (no user gesture, or a cross-origin iframe without
    // `allow="fullscreen"`) is a routing decision, not an error to report.
    return false;
  }
  return false;
}

/** Give the screen back, under either spelling. Safe to call when not in it. */
export async function exitFullscreen(doc: FullscreenCapableDocument | null): Promise<void> {
  if (!doc || !activeFullscreenElement(doc)) return;
  try {
    if (typeof doc.exitFullscreen === "function") await doc.exitFullscreen();
    else if (typeof doc.webkitExitFullscreen === "function") doc.webkitExitFullscreen();
  } catch {
    // Nothing to recover: the page is either in the state we wanted or not.
  }
}

/**
 * Does this keypress mean "give the card its screen back"?
 *
 * Escape has to mean "close the thing on top", and there are three layers it
 * could be aimed at:
 *
 * - While the browser is holding full screen (`immersive`), it owns Escape and
 *   exits by itself; the `fullscreenchange` listener collapses the card from
 *   there. Acting here too would spend one press on both.
 * - While a portalled layer is open above the card — the draft picker is a
 *   dropdown ON the expanded card — Escape is aimed at that layer. Collapsing
 *   the card as well would throw the user out of full screen and lose the draft
 *   they were building.
 * - Otherwise the card is a fixed overlay with nothing above it, and Escape is
 *   the only way back out. That is the one case that closes it.
 */
export function escapeClosesOverlay(key: string, immersive: boolean, layerOpen: boolean): boolean {
  return key === "Escape" && !immersive && !layerOpen;
}
