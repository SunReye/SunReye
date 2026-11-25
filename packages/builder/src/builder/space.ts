// Space held down pans the canvas whatever a press lands on, as in drawing tools (ADR 20
// "Navigation"): the presses that would drag or lay something let it pass to the camera.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */

let held = false;
let watchers = 0;

/** Whether the key is a text field's: there, Space types. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const down = (event: KeyboardEvent): void => {
  if (event.code !== "Space" || typing(event.target)) return;

  held = true;

  // A button keeps Space for itself; the page under the canvas never scrolls.
  if (event.target === document.body || event.target instanceof HTMLCanvasElement) {
    event.preventDefault();
  }
};

const up = (event: KeyboardEvent): void => {
  if (event.code === "Space") held = false;
};

const lost = (): void => {
  held = false;
};

/** Whether Space is held now. */
export const spaceHeld = (): boolean => held;

/** Follows the key while any canvas asks; returns the canvas's release. */
export function watchSpace(): () => void {
  if (watchers === 0) {
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", lost);
  }

  watchers += 1;

  return () => {
    watchers -= 1;

    if (watchers > 0) return;

    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", lost);
    held = false;
  };
}
