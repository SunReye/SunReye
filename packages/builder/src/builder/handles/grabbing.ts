// The pointer on the handles (ADR 20): a press on a handle, or on the selected object itself,
// takes the pointer from the orbit controls and drags until let go; anywhere else it orbits.
// Mouse, pen and touch alike. A second finger lets the drag go and hands both fingers to the orbit
// controls, which pan and zoom.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import {
  type Group,
  type OrthographicCamera,
  type PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { haptics } from "@sunreye/ui/haptics";
import { spaceHeld } from "../space.ts";
import { bodyAt, same } from "./body-at.ts";
import type { Pv, Scene } from "../pv.ts";
import { strike, toThree, type Panel } from "../scene.ts";
import { PER_PIXEL, sense, turnOf } from "./dial.ts";
import { handleOf } from "./gizmo.ts";
import {
  drag,
  handles,
  turned,
  type Dragged,
  type Grab,
  type Handle,
  type Laid,
  type Ray,
  type Target,
  type Triple,
} from "./grips.ts";
import { Handover, listen, ndc } from "../pointer.ts";

/** What the handles edit, and where a drag goes. */
export interface Editing {
  readonly scene: Scene;
  readonly target: Target;
  /** The crate, which keeps a chimney on its face and an opening on its wall and finds the
   * chimney a press strikes; and what it laid out for `scene`, which their handles stand on. */
  readonly pv: Pick<
    Pv,
    "refit" | "glide" | "glideWindow" | "chimneyAt" | "roofWindowAt" | "gridAt"
  >;
  readonly laid: Laid;
  /** The turn mode: a drag anywhere turns the object, and nothing else of it drags. */
  readonly turning: boolean;
  /** A press on a picked block's own surface, its roof included, moves it: an editor's navigation,
   * where a drag on empty ground pans, not orbits (ADR 20 "Navigation"). */
  readonly wholeBlock?: boolean;
  /** Each step of a drag, shown at once. */
  readonly ondrag: (scene: Scene) => void;
  /** The drag let go: one undo step. */
  readonly ondrop: () => void;
}

/** A dragging handle's live value, and where it stands now. */
export interface Reading {
  readonly value: Dragged["value"];
  readonly unit: Dragged["unit"];
  readonly at: Triple;
}

export interface Sources {
  readonly editing: () => Editing | undefined;
  readonly drawn: () => Group | undefined;
  readonly handles: () => Group | undefined;
  readonly panels: () => readonly Panel[];
  /** The live value, or none once let go. */
  readonly onreading: (reading?: Reading) => void;
}

/** A drag starts once the pointer has travelled this many pixels: a tap that slips changes
 * nothing (ADR 20, mistaken drags). */
const SLIP = 8;

/** How far the held pointer has gone, in pixels: a dial counts its travel sideways alone. */
const travel = ({ down, at, dial }: Held): number =>
  dial === 0 ? Math.hypot(at[0] - down[0], at[1] - down[1]) : Math.abs(at[0] - down[0]);

interface Held {
  readonly pointer: number;
  readonly grab: Grab;
  readonly editing: Editing;
  readonly down: readonly [number, number];
  /** Where the pointer is now. */
  at: readonly [number, number];
  moving: boolean;
  /** The turn mode's dial: the pointer's travel sideways turns, wherever it was pressed; with
   * the clock for each pixel to the right where this is 1, against it where −1, else no dial. */
  readonly dial: -1 | 0 | 1;
  /** The turn as last shown, as text: a turn ticks when it changes. */
  shown: string;
}

function rayAt(camera: PerspectiveCamera | OrthographicCamera, at: readonly [number, number]): Ray {
  const caster = new Raycaster();

  caster.setFromCamera(new Vector2(...at), camera);

  return { origin: caster.ray.origin.toArray(), direction: caster.ray.direction.toArray() };
}

/** Listens on a canvas, before the orbit controls and the click picking. */
export class Grabbing {
  readonly #canvas: HTMLCanvasElement;
  readonly #camera: PerspectiveCamera | OrthographicCamera;
  readonly #sources: Sources;
  #held: Held | undefined;

  readonly #handover = new Handover();

  /** Stops listening. */
  readonly dispose: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera | OrthographicCamera,
    sources: Sources,
  ) {
    this.#canvas = canvas;
    this.#camera = camera;
    this.#sources = sources;
    this.dispose = listen(canvas, { press: this.#press, move: this.#move, release: this.#release });
  }

  #handleAt(at: readonly [number, number]): Handle | null {
    const shown = this.#sources.handles();

    // A press may come before the next draw has placed the camera's and the handles' matrices.
    this.#camera.updateMatrixWorld();
    shown?.updateMatrixWorld();

    return shown === undefined
      ? null
      : handleOf(shown, this.#camera, at, this.#canvas, this.#sources.drawn());
  }

  /** A handle, or the selected object's own surface: what the press grabbed. */
  #grabbed(at: readonly [number, number], editing: Editing): Grab | undefined {
    const ray = rayAt(this.#camera, at);

    const handle = this.#handleAt(at);

    // The turn mode: off the ring, which may lie outside the canvas, the canvas is a dial.
    if (editing.turning && handle === null) return { grip: "turn", ray, height: 0 };

    if (handle !== null) {
      // A block's knob carries it as its footprint would.
      const grip = handle.grip === "carry" ? "move" : handle.grip;

      return { grip, point: handle.point, ray, height: handle.at[1], at: handle.at };
    }

    return this.#bodyGrabbed(at, editing, ray);
  }

  /** The selected object's own surface under the press, which moves it whole. */
  #bodyGrabbed(at: readonly [number, number], editing: Editing, ray: Ray): Grab | undefined {
    const group = this.#sources.drawn();
    const hit = group && strike(group, this.#sources.panels(), this.#camera, at);

    // An opening is grabbed by its own leaf.
    if (hit?.kind === "opening") {
      return same(editing.target, { kind: "opening", index: hit.index })
        ? { grip: "move", ray, height: 0 }
        : undefined;
    }

    const point = bodyAt(hit, editing);

    return point && { grip: "move", ray, height: point[2], at: toThree(point) };
  }

  readonly #press = (event: PointerEvent): void => {
    if (this.#handover.handed(event)) return;

    if (this.#held !== undefined) {
      if (event.pointerType === "touch") this.#handOver(this.#held);
      else event.stopImmediatePropagation();

      return;
    }

    // Space held pans, whatever the press lands on.
    const editing = event.button === 0 && !spaceHeld() ? this.#sources.editing() : undefined;
    const grab = editing && this.#grabbed(ndc(this.#canvas, event), editing);

    if (editing !== undefined && grab !== undefined) this.#hold(event, editing, grab);
  };

  /** Takes the pointer: the orbit controls and the click picking never see it. */
  #hold(event: PointerEvent, editing: Editing, grab: Grab): void {
    event.stopImmediatePropagation();
    this.#canvas.setPointerCapture(event.pointerId);
    this.#held = {
      pointer: event.pointerId,
      grab,
      editing,
      down: [event.clientX, event.clientY],
      at: [event.clientX, event.clientY],
      moving: false,
      // Off the ring nothing was grabbed at a point.
      dial:
        editing.turning && grab.at === undefined
          ? sense(editing, grab.ray, this.#camera.getWorldDirection(new Vector3()).toArray())
          : 0,
      shown: String(turnOf(editing)),
    };
    this.#canvas.style.cursor = "grabbing";
  }

  readonly #move = (event: PointerEvent): void => {
    const held = this.#held;

    if (held === undefined) {
      if (event.pointerType === "mouse") {
        this.#canvas.style.cursor = this.#handleAt(ndc(this.#canvas, event)) === null ? "" : "grab";
      }

      return;
    }

    if (event.pointerId !== held.pointer) return;

    event.stopImmediatePropagation();
    held.at = [event.clientX, event.clientY];
    held.moving ||= travel(held) >= SLIP;

    if (held.moving) this.#step(held, rayAt(this.#camera, ndc(this.#canvas, event)));
  };

  /** What the held drag makes of the scene now. */
  #dragged(held: Held, ray: Ray): Dragged | null {
    const { editing, grab } = held;

    const sweep = (held.at[0] - held.down[0]) * PER_PIXEL * held.dial;

    return held.dial === 0
      ? drag(editing.scene, editing.target, grab, ray, editing)
      : turned(editing.scene, editing.target, sweep);
  }

  #step(held: Held, ray: Ray): void {
    const { editing, grab } = held;
    const dragged = this.#dragged(held, ray);

    if (dragged === null) return;

    const shown = dragged.value.join(" ");

    // Each snapped step of a turn is felt.
    if (grab.grip === "turn" && shown !== held.shown) haptics.selection();

    held.shown = shown;

    editing.ondrag(dragged.scene);

    // Once the step is shown, its handles stand on what the crate laid out for it.
    const now = this.#sources.editing();
    const laid = now?.scene === dragged.scene ? now.laid : editing.laid;

    const at = handles(dragged.scene, editing.target, laid).find(
      (item) => item.grip === grab.grip && item.point === grab.point,
    )?.at;

    if (at !== undefined) this.#sources.onreading({ value: dragged.value, unit: dragged.unit, at });
  }

  /** Puts the dragged object back, unrecorded, and presses the first finger again where it is now,
   * for the orbit controls; the second finger's press follows it there. */
  #handOver(held: Held): void {
    if (held.moving) {
      held.editing.ondrag(held.editing.scene);
      held.editing.ondrop();
    }

    this.#held = undefined;
    this.#sources.onreading();
    this.#canvas.style.cursor = "";

    this.#handover.give(this.#canvas, held.pointer, held.at);
  }

  readonly #release = (event: PointerEvent): void => {
    const held = this.#held;

    if (held?.pointer !== event.pointerId) return;

    event.stopImmediatePropagation();

    if (held.moving) held.editing.ondrop();

    this.#held = undefined;
    this.#sources.onreading();
    this.#canvas.style.cursor = "";
  };
}
