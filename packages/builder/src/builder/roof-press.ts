// Laying modules and selecting them for wiring in 3D (ADR 20). A press that starts a gesture (gestures.ts)
// never reaches the orbit controls or the click picking; any other orbits, and a second finger
// hands both to the orbit controls. A mouse over the selected face shows the ghost module. Each
// gesture is one undo step. Mouse, pen and touch.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Group, PerspectiveCamera } from "three";
import { onPlane, type Aim } from "./aim.ts";
import { hover, lay, select, type Roofwork, type Press } from "./gestures.ts";
import type { Ghost } from "./pv.ts";
import { strike, type Panel } from "./scene.ts";
import { Handover, listen, ndc } from "./pointer.ts";

export type { Roofwork } from "./gestures.ts";

export interface RoofSources {
  readonly roofwork: () => Roofwork | undefined;
  readonly drawn: () => Group | undefined;
  readonly panels: () => readonly Panel[];
  /** The modules not laid yet, to show under the pointer. */
  readonly onghost: (ghosts: readonly Ghost[]) => void;
}

/** Further than this many pixels from its press, a pointer dragged. */
const TAP = 5;

interface Held {
  readonly pointer: number;
  readonly gesture: Press;
  readonly down: readonly [number, number];
  /** Where the pointer is now, for the orbit controls if a second finger comes. */
  at: readonly [number, number];
  dragged: boolean;
}

/** Listens on a canvas, before the orbit controls and the click picking. */
export class RoofPress {
  readonly #canvas: HTMLCanvasElement;
  readonly #camera: PerspectiveCamera;
  readonly #sources: RoofSources;
  #held: Held | undefined;

  readonly #handover = new Handover();

  /** Stops listening. */
  readonly dispose: () => void;

  constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera, sources: RoofSources) {
    this.#canvas = canvas;
    this.#camera = camera;
    this.#sources = sources;

    const unlisten = listen(canvas, {
      press: this.#press,
      move: this.#move,
      release: this.#release,
    });

    canvas.addEventListener("pointerleave", this.#leave);
    this.dispose = () => {
      unlisten();
      canvas.removeEventListener("pointerleave", this.#leave);
    };
  }

  /** Where `event` aims in the drawn scene. */
  #aim(event: PointerEvent): Aim {
    // A press may come before the first draw has placed the camera's matrices.
    this.#camera.updateMatrixWorld();

    const at = ndc(this.#canvas, event);

    return {
      at: [event.clientX, event.clientY],
      hit: () => {
        const group = this.#sources.drawn();

        return group === undefined ? null : strike(group, this.#sources.panels(), this.#camera, at);
      },
      onFace: (roof) => onPlane(this.#camera, at, roof),
    };
  }

  readonly #press = (event: PointerEvent): void => {
    if (this.#handover.handed(event)) return;

    if (this.#held !== undefined) {
      this.#another(event, this.#held);

      return;
    }

    const roofwork = this.#sources.roofwork();

    if (roofwork === undefined || event.button !== 0) return;

    const aim = this.#aim(event);

    const gesture =
      roofwork.kind === "wiring" ? select(roofwork, aim) : lay(roofwork, aim, this.#sources);

    if (gesture !== null) this.#hold(event, gesture);
  };

  /** Another pointer during a drag: a second finger hands both to the orbit controls; anything
   * else is kept from them. */
  #another(event: PointerEvent, held: Held): void {
    if (event.pointerType !== "touch") {
      event.stopImmediatePropagation();

      return;
    }

    this.#held = undefined;
    held.gesture.abort();
    this.#handover.give(this.#canvas, held.pointer, held.at);
  }

  /** The press is the gesture's: the orbit controls and the click picking never see it. */
  #hold(event: PointerEvent, gesture: Press): void {
    event.stopImmediatePropagation();
    this.#canvas.setPointerCapture(event.pointerId);

    const down = [event.clientX, event.clientY] as const;

    this.#held = { pointer: event.pointerId, gesture, down, at: down, dragged: false };
  }

  readonly #move = (event: PointerEvent): void => {
    const held = this.#held;

    if (held === undefined) {
      this.#hover(event);

      return;
    }

    if (held.pointer !== event.pointerId) return;

    event.stopImmediatePropagation();
    held.at = [event.clientX, event.clientY];
    held.dragged ||= Math.hypot(held.at[0] - held.down[0], held.at[1] - held.down[1]) > TAP;
    held.gesture.move(this.#aim(event));
  };

  /** A mouse over the selected face: the ghost module follows it. */
  #hover(event: PointerEvent): void {
    const roofwork = this.#sources.roofwork();

    if (event.pointerType === "mouse" && roofwork?.kind === "modules") {
      this.#sources.onghost(hover(roofwork, this.#aim(event)));
    }
  }

  readonly #leave = (): void => {
    if (this.#held === undefined) this.#sources.onghost([]);
  };

  /** Let go: the gesture ends, or is put back where the browser took the pointer away. */
  readonly #release = (event: PointerEvent): void => {
    const held = this.#held;

    if (held?.pointer !== event.pointerId) return;

    event.stopImmediatePropagation();
    this.#held = undefined;

    if (event.type === "pointerup") held.gesture.drop(!held.dragged);
    else held.gesture.abort();
  };
}
