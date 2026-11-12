// String painting in 3D (ADR 20): with a string picked, a press on a module paints the modules the
// pointer crosses, on any face, as one undo step; a press elsewhere orbits. Mouse, pen and touch.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Group, PerspectiveCamera } from "three";
import { haptics } from "../haptics.ts";
import { m } from "../paraglide/messages.js";
import { paint, refuses, strokeOf, type At, type Draft, type Stroke } from "./modules.ts";
import type { Scene } from "./pv.ts";
import { strike, type Panel } from "./scene.ts";

/** The picked string, and where a paint drag's steps go. */
export interface Painting {
  readonly draft: Draft;
  /** By position in the draft's strings. */
  readonly string: number;
  /** Each step, shown at once. */
  readonly ondrag: (scene: Scene) => void;
  /** Let go: one undo step. */
  readonly ondrop: () => void;
}

/** Why a module refused the paint, beside the pointer in canvas pixels. */
export interface Refused {
  readonly text: string;
  readonly left: number;
  readonly top: number;
}

export interface Brushing {
  readonly painting: () => Painting | undefined;
  readonly drawn: () => Group | undefined;
  readonly panels: () => readonly Panel[];
  /** A refusal, or none once the next press starts. */
  readonly onrefuse: (refused?: Refused) => void;
}

/** A module under the pointer: its grid, its cell, and both as one key. */
interface Under {
  readonly grid: number;
  readonly at: At;
  readonly key: string;
}

interface Held {
  readonly pointer: number;
  readonly stroke: Stroke;
  last: string;
}

/** Listens on a canvas, before the orbit controls and the click picking. */
export class Brush {
  readonly #canvas: HTMLCanvasElement;
  readonly #camera: PerspectiveCamera;
  readonly #sources: Brushing;
  #held: Held | undefined;

  constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera, sources: Brushing) {
    this.#canvas = canvas;
    this.#camera = camera;
    this.#sources = sources;
    canvas.addEventListener("pointerdown", this.#press);
    canvas.addEventListener("pointermove", this.#move);
    canvas.addEventListener("pointerup", this.#release);
    canvas.addEventListener("pointercancel", this.#release);
  }

  dispose(): void {
    this.#canvas.removeEventListener("pointerdown", this.#press);
    this.#canvas.removeEventListener("pointermove", this.#move);
    this.#canvas.removeEventListener("pointerup", this.#release);
    this.#canvas.removeEventListener("pointercancel", this.#release);
  }

  /** The module under the pointer: its grid and cell. */
  #under(event: PointerEvent): Under | null {
    const group = this.#sources.drawn();
    const box = this.#canvas.getBoundingClientRect();

    if (group === undefined) return null;

    // A press may come before the first draw has placed the camera's matrices.
    this.#camera.updateMatrixWorld();

    const hit = strike(group, this.#sources.panels(), this.#camera, [
      ((event.clientX - box.left) / box.width) * 2 - 1,
      1 - ((event.clientY - box.top) / box.height) * 2,
    ]);

    return hit?.kind === "grid" && hit.cell !== undefined
      ? { grid: hit.grid, at: hit.cell, key: `${hit.grid}.${hit.cell.row}.${hit.cell.column}` }
      : null;
  }

  /** Paints one module, or answers beside the pointer why its grid refuses the string. */
  #paint(painting: Painting, stroke: Stroke, event: PointerEvent, grid: number, at: At): void {
    if (refuses(painting.draft, grid, stroke)) {
      const box = this.#canvas.getBoundingClientRect();

      haptics.error();
      this.#sources.onrefuse({
        text: m.builder_refused_module_type({
          name: painting.draft.strings[painting.string]?.name ?? "",
        }),
        left: event.clientX - box.left,
        top: event.clientY - box.top,
      });

      return;
    }

    painting.ondrag(paint(painting.draft.scene, grid, at, stroke));
  }

  readonly #press = (event: PointerEvent): void => {
    const painting = this.#sources.painting();

    if (painting === undefined || event.button !== 0 || this.#held !== undefined) return;

    const under = this.#under(event);

    if (under === null) return;

    // The orbit controls and the click picking never see it.
    event.stopImmediatePropagation();
    this.#canvas.setPointerCapture(event.pointerId);
    this.#sources.onrefuse();

    const stroke = strokeOf(painting.draft.scene, under.grid, under.at, {
      kind: "paint",
      string: painting.string,
    });

    this.#held = { pointer: event.pointerId, stroke, last: under.key };
    this.#paint(painting, stroke, event, under.grid, under.at);
  };

  readonly #move = (event: PointerEvent): void => {
    const held = this.#held;
    const painting = this.#sources.painting();

    if (held?.pointer !== event.pointerId || painting === undefined) return;

    event.stopImmediatePropagation();

    const under = this.#under(event);

    if (under === null || under.key === held.last) return;

    held.last = under.key;
    this.#paint(painting, held.stroke, event, under.grid, under.at);
  };

  readonly #release = (event: PointerEvent): void => {
    if (this.#held?.pointer !== event.pointerId) return;

    event.stopImmediatePropagation();
    this.#held = undefined;
    this.#sources.painting()?.ondrop();
  };
}
