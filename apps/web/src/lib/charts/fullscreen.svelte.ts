/**
 * The reactive half of "take this box to the whole screen": which element, is
 * it expanded, and by which of the two mechanisms.
 *
 * Everything decidable lives next door in `fullscreen.ts` (plain TS, tested);
 * what is left here is state and DOM listeners, which is why this is a rune
 * module and has no unit test of its own — see apps/web/TESTING.md.
 *
 * Shared by `layout/section.svelte` (where the trigger sits in the card's own
 * header, next to the title that already names the chart) and by
 * `layout/chart-fullscreen.svelte` (for the charts that live in a dialog or a
 * card rather than a section).
 */

import {
  activeFullscreenElement,
  escapeClosesOverlay,
  exitFullscreen,
  fullscreenMode,
  fullscreenTarget,
  requestFullscreen,
} from "./fullscreen";

export class FullscreenBox {
  expanded = $state(false);
  /**
   * The browser also hid its own chrome. Records what happened; it changes no
   * classes, because the card fills the screen by a fixed overlay either way.
   */
  immersive = $state(false);

  open = async (): Promise<void> => {
    // The card fills the screen the instant this flips — the native call below
    // only takes the browser's chrome away on top of that. Setting it first is
    // what makes the iPhone and the ingress-iframe cases feel identical.
    this.expanded = true;
    const target = fullscreenTarget(document);
    if (fullscreenMode(target) === "native") this.immersive = await requestFullscreen(target);
  };

  close = async (): Promise<void> => {
    if (this.immersive) await exitFullscreen(document);
    this.immersive = false;
    this.expanded = false;
  };

  toggle = (): void => {
    void (this.expanded ? this.close() : this.open());
  };

  /**
   * Keep the flag honest against the browser. Call from an `$effect` and return
   * the result — it is the cleanup.
   *
   * Two ways out that never touch our button: the browser's own exit (Escape, a
   * swipe, the system control) while immersive, and Escape when it is only the
   * overlay, which has no browser behaviour of its own. Without the first the
   * card would stay expanded over a page that is no longer full screen.
   */
  listen = (): (() => void) => {
    // Whether something portalled is open above the card. Read at the moment of
    // the keypress rather than tracked: these layers mount and unmount into
    // `document.body` from four different components, and a flag we maintained
    // ourselves would be the thing that goes stale.
    const layerOpen = () =>
      document.querySelector(
        "[data-slot=dropdown-menu-content],[data-slot=popover-content],[data-slot=dialog-content],[data-slot=select-content],[data-slot=sheet-content]",
      ) !== null;
    const sync = () => {
      if (!this.immersive) return;
      if (activeFullscreenElement(document) !== fullscreenTarget(document)) {
        this.immersive = false;
        this.expanded = false;
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (escapeClosesOverlay(event.key, this.immersive, layerOpen())) void this.close();
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
      document.removeEventListener("keydown", onKey);
    };
  };
}
