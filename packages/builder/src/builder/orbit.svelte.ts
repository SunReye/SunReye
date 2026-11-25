// The canvas's camera (ADR 20): fitted to the canvas, orbited by a drag and flown to each view
// its consumer gives.
import { fitLens, type Lens } from "./lens.ts";
import { untrack } from "svelte";
import type { Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Lit } from "../scene/stage.svelte.ts";
import type { View } from "./camera.ts";
import { controlsOf, type Navigation } from "./navigation.ts";

export { lensOf, type Lens } from "./lens.ts";

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own.
const aspectOf = (canvas: HTMLCanvasElement): number =>
  canvas.clientWidth / Math.max(canvas.clientHeight, 1);

/** Fits the drawing buffer and the camera to the canvas whenever its size changes. */
export function fit(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- observed for its size.
  canvas: HTMLCanvasElement,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sizes it.
  studio: Lit["studio"],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js fits it.
  camera: Lens,
  render: () => void,
  /** What the camera looks at: a parallel one's frustum is sized at it. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the controls move it.
  target: Vector3,
): ResizeObserver {
  const resize = new ResizeObserver(() => {
    studio.setSize(canvas.clientWidth, canvas.clientHeight);
    fitLens(camera, aspectOf(canvas), target);
    render();
  });

  resize.observe(canvas);

  return resize;
}

/** Flies the camera to each `view` given, from wherever it is; places the first at once. */
function follow(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js moves it.
  camera: Lens,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js moves it.
  controls: OrbitControls,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it flies the camera.
  flight: Lit["flight"],
  render: () => void,
  view: () => View,
): void {
  const place = ({ position, target }: View): void => {
    camera.position.set(...position);
    controls.target.set(...target);
    // Dispatches "change", which draws.
    controls.update();
  };

  let placed = false;

  $effect(() => {
    const to = view();

    untrack(() => {
      const from = { position: camera.position.toArray(), target: controls.target.toArray() };

      if (!placed) {
        placed = true;
        place(to);
      } else if (JSON.stringify(from) !== JSON.stringify(to)) {
        flight.fly(from, to, place);
        render();
      }
    });
  });
}

/** What the canvas's consumer says of its camera. */
export interface Orbiting {
  readonly view: () => View;
  /** The camera stays put and a finger on the canvas scrolls the page (ADR 20). */
  readonly locked: () => boolean;
  /** The view the admin orbited to, once they let go. */
  readonly onview: (view: View) => void;
}

/** Orbits the camera on a drag and reports the view once let go; flies it to each view given. */
export function orbit(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js listens on it.
  canvas: HTMLCanvasElement,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js moves it.
  camera: Lens,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it flies the camera.
  flight: Lit["flight"],
  render: () => void,
  { view, locked, onview }: Orbiting,
  /** What a drag, a button and the wheel do to the camera. */
  navigation: () => Navigation = () => "orbit",
): OrbitControls {
  const controls = new OrbitControls(camera, canvas);

  // Before the draw: a parallel camera's zoom and distance are its frustum.
  controls.addEventListener("change", () => {
    fitLens(camera, aspectOf(canvas), controls.target);
  });
  controls.addEventListener("change", render);
  // The admin's hand takes the camera from a flight.
  controls.addEventListener("start", () => {
    flight.stop();
  });
  controls.addEventListener("end", () => {
    // A scroll the browser takes from a locked canvas cancels the pointer, which also ends here.
    if (!controls.enabled) return;

    onview({ position: camera.position.toArray(), target: controls.target.toArray() });
  });
  follow(camera, controls, flight, render, view);

  $effect(() => {
    const { mouseButtons, touches, enableRotate, zoomToCursor } = controlsOf(navigation());

    controls.mouseButtons = mouseButtons;
    controls.touches = touches;
    controls.enableRotate = enableRotate;
    controls.zoomToCursor = zoomToCursor;
  });

  $effect(() => {
    controls.enabled = !locked();
    // Over the controls' own inline "none".
    canvas.style.touchAction = locked() ? "pan-y" : "none";
  });

  return controls;
}
