// Explore's fullscreen (ADR 22). The screen fills the window by itself, and the page goes into the
// browser's fullscreen where that is granted. The page, not the chart area: the range's calendar
// and lists open on the body, outside a fullscreen element. It is the screen's own state, never
// the route's: a browser enters fullscreen only on a gesture.

export class Fullscreen {
  on = $state(false);

  readonly toggle = (): void => {
    if (this.on) this.leave();
    else this.#enter();
  };

  readonly leave = (): void => {
    this.on = false;

    if (document.fullscreenElement) void document.exitFullscreen();
  };

  /** Attached to the screen: follows the browser's fullscreen and Esc, and leaves with the screen. */
  readonly watch = (): (() => void) => {
    const stop = new AbortController();

    // Left by the browser's own Esc or gesture, the screen follows.
    document.addEventListener(
      "fullscreenchange",
      () => {
        if (!document.fullscreenElement) this.on = false;
      },
      { signal: stop.signal },
    );
    // Esc leaves a filled window; the browser's fullscreen takes the key itself. An overlay that
    // closed on this Esc prevented it.
    addEventListener(
      "keydown",
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
      (e: KeyboardEvent) => {
        if (this.on && e.key === "Escape" && !e.defaultPrevented) this.leave();
      },
      { signal: stop.signal },
    );

    // Another screen must not inherit the browser's fullscreen.
    return () => {
      stop.abort();
      this.leave();
    };
  };

  #enter(): void {
    this.on = true;

    // Unset on iPhone Safari, false in a frame without the permission.
    if (!document.fullscreenEnabled) return;

    // Refused, the window stays filled.
    document.documentElement.requestFullscreen().catch(() => {});
  }
}
