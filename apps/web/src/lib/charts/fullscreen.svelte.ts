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
  exitFullscreen,
  fullscreenMode,
  requestFullscreen,
} from "./fullscreen";

export class FullscreenBox {
  /** The element that goes full-screen. Bound by the component. */
  box = $state<HTMLElement | null>(null);
  expanded = $state(false);
  /** The native request was unavailable or refused, so we paint our own. */
  overlay = $state(false);

  open = async (): Promise<void> => {
    if (fullscreenMode(this.box) === "native" && (await requestFullscreen(this.box))) {
      this.expanded = true;
      return;
    }
    // iPhone Safari, or a cross-origin iframe without `allow="fullscreen"` —
    // which is how this app runs under Home Assistant ingress. The chart still
    // fills the screen; it just keeps the browser's own chrome above it.
    this.overlay = true;
    this.expanded = true;
  };

  close = async (): Promise<void> => {
    if (!this.overlay) await exitFullscreen(document);
    this.overlay = false;
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
   * swipe, the system control) for the native path, and Escape for the overlay,
   * which has no browser behaviour of its own. Without the first the chart
   * would come back to the page still wearing its expanded classes.
   */
  listen = (): (() => void) => {
    const sync = () => {
      if (this.overlay) return;
      if (activeFullscreenElement(document) !== this.box) this.expanded = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && this.overlay) void this.close();
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
