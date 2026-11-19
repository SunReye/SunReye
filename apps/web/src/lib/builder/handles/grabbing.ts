// The pointer on the handles (ADR 20): a press on a handle, or on the selected object itself,
// takes the pointer from the orbit controls and drags until let go; anywhere else it orbits.
// Mouse, pen and touch alike. A second finger lets the drag go and hands both fingers to the orbit
// controls, which pan and zoom.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import { type Group, type PerspectiveCamera, Raycaster, Vector2 } from "three";
import { picked } from "../levels.ts";
import type { Pv, Scene } from "../pv.ts";
import { strike, toThree, type Panel } from "../scene.ts";
import { handleOf } from "./gizmo.ts";
import {
  drag,
  handles,
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

/** A move starts once the pointer has travelled this many pixels: a tap still picks. */
const CLICK = 5;

interface Held {
  readonly pointer: number;
  readonly grab: Grab;
  readonly editing: Editing;
  readonly down: readonly [number, number];
  /** Where the pointer is now. */
  at: readonly [number, number];
  moving: boolean;
}

const same = (a: Target, b: { readonly kind: string; readonly index?: number }): boolean =>
  a.kind === b.kind && a.index === b.index;

function rayAt(camera: PerspectiveCamera, at: readonly [number, number]): Ray {
  const caster = new Raycaster();

  caster.setFromCamera(new Vector2(...at), camera);

  return { origin: caster.ray.origin.toArray(), direction: caster.ray.direction.toArray() };
}

/** Listens on a canvas, before the orbit controls and the click picking. */
export class Grabbing {
  readonly #canvas: HTMLCanvasElement;
  readonly #camera: PerspectiveCamera;
  readonly #sources: Sources;
  #held: Held | undefined;

  readonly #handover = new Handover();

  /** Stops listening. */
  readonly dispose: () => void;

  constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera, sources: Sources) {
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

    return shown === undefined ? null : handleOf(shown, this.#camera, at, this.#canvas);
  }

  /** A handle, or the selected object's own surface: what the press grabbed. */
  #grabbed(at: readonly [number, number], editing: Editing): Grab | undefined {
    const handle = this.#handleAt(at);
    const ray = rayAt(this.#camera, at);

    if (handle !== null)
      return { grip: handle.grip, point: handle.point, ray, height: handle.at[1], at: handle.at };

    // A fence has no footprint to drag.
    return editing.target.kind === "fence" ? undefined : this.#bodyGrabbed(at, editing, ray);
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

    if (hit?.kind !== "point") return undefined;

    const level = picked(editing.scene, hit, editing.pv);

    return level !== null && same(editing.target, level)
      ? { grip: "move", ray, height: hit.point[2], at: toThree(hit.point) }
      : undefined;
  }

  readonly #press = (event: PointerEvent): void => {
    if (this.#handover.handed(event)) return;

    if (this.#held !== undefined) {
      if (event.pointerType === "touch") this.#handOver(this.#held);
      else event.stopImmediatePropagation();

      return;
    }

    const editing = this.#sources.editing();

    const grab =
      editing === undefined || event.button !== 0
        ? undefined
        : this.#grabbed(ndc(this.#canvas, event), editing);

    if (editing === undefined || grab === undefined) return;

    // The orbit controls and the click picking never see it.
    event.stopImmediatePropagation();
    this.#canvas.setPointerCapture(event.pointerId);
    this.#held = {
      pointer: event.pointerId,
      grab,
      editing,
      down: [event.clientX, event.clientY],
      at: [event.clientX, event.clientY],
      moving: grab.grip !== "move",
    };
    this.#canvas.style.cursor = "grabbing";
  };

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
    held.moving ||= Math.hypot(event.clientX - held.down[0], event.clientY - held.down[1]) >= CLICK;

    if (held.moving) this.#step(held, rayAt(this.#camera, ndc(this.#canvas, event)));
  };

  #step({ editing, grab }: Held, ray: Ray): void {
    const dragged = drag(editing.scene, editing.target, grab, ray, editing);

    if (dragged === null) return;

    editing.ondrag(dragged.scene);

    // Once the step is shown, its handles stand on what the crate laid out for it.
    const shown = this.#sources.editing();
    const laid = shown?.scene === dragged.scene ? shown.laid : editing.laid;

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
