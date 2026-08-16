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
 * value the caller can branch on rather than throwing, and the component keeps
 * a fixed-position overlay for the cases where the native path is unavailable
 * or refused. The overlay costs the browser's own chrome and nothing else.
 */

/** The subset of `Element` this module touches, plus the prefixed spelling. */
export interface FullscreenCapableElement {
  requestFullscreen?: (() => Promise<void>) | undefined;
  webkitRequestFullscreen?: (() => void) | undefined;
}

/** The subset of `Document` this module touches, plus the prefixed spelling. */
export interface FullscreenCapableDocument {
  fullscreenElement?: unknown;
  webkitFullscreenElement?: unknown;
  exitFullscreen?: (() => Promise<void>) | undefined;
  webkitExitFullscreen?: (() => void) | undefined;
}

/** Which mechanism a chart box can use. */
export type FullscreenMode = "native" | "overlay";

/**
 * Whether this element can go full-screen for real, or needs the overlay.
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
