// How the pointer moves the camera (ADR 20 "Navigation"): the builder's own orbit for a finger, or
// an editor's, where a drag on empty ground pans as in a plan or a drawing tool and orbiting takes
// the right button or Shift. Pure.
import { MOUSE, TOUCH } from "three";

/**
 * - `orbit`: a drag orbits, the right button pans, the wheel zooms to the middle (the builder's).
 * - `plan`: seen from above and held north up; every button pans, the wheel zooms to the cursor.
 * - `model`: the left and middle buttons pan, the right one or Shift with the left orbits, the
 *   wheel zooms to the cursor; one finger orbits, two pan and pinch.
 */
export type Navigation = "orbit" | "plan" | "model";

/** What `OrbitControls` is set to for a navigation. */
export interface Controls {
  readonly mouseButtons: { LEFT: MOUSE; MIDDLE: MOUSE; RIGHT: MOUSE };
  readonly touches: { ONE: TOUCH; TWO: TOUCH };
  readonly enableRotate: boolean;
  readonly zoomToCursor: boolean;
}

/** The controls' settings for `navigation`. `OrbitControls` turns a pan with Shift, Ctrl or Meta
 * into an orbit, and an orbit with them into a pan. */
export function controlsOf(navigation: Navigation): Controls {
  if (navigation === "orbit") {
    return {
      mouseButtons: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN },
      touches: { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN },
      enableRotate: true,
      zoomToCursor: false,
    };
  }

  const plan = navigation === "plan";

  return {
    mouseButtons: { LEFT: MOUSE.PAN, MIDDLE: MOUSE.PAN, RIGHT: plan ? MOUSE.PAN : MOUSE.ROTATE },
    touches: { ONE: plan ? TOUCH.PAN : TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN },
    enableRotate: !plan,
    zoomToCursor: true,
  };
}
