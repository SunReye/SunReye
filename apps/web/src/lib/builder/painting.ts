// Laying modules and wiring strings in 3D (ADR 20). With a face selected, a press on one of its
// free cells places modules along the pointer's path and one on its module erases; a tap on a
// module selects it. With a string picked, a press on a module wires the modules the pointer
// crosses, in that order, on any face. Each drag is one undo step; a press elsewhere orbits, and a
// second finger hands both to the orbit controls. Mouse, pen and touch.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Group, PerspectiveCamera } from "three";
import { haptics } from "../haptics.ts";
import { m } from "../paraglide/messages.js";
import {
  paint,
  refuses,
  strokeOf,
  type At,
  type Draft,
  type Stroke,
  type Tool,
} from "./modules.ts";
import { cellAt } from "./cells.ts";
import type { CellPlace, Modules, Point, Scene } from "./pv.ts";
import { strike, type Hit, type Panel } from "./scene.ts";
import { Handover, listen, ndc } from "./pointer.ts";

export interface Steps {
  readonly draft: Draft;
  /** Each step, shown at once. */
  readonly ondrag: (scene: Scene) => void;
  /** Let go: one undo step. */
  readonly ondrop: () => void;
}

/** A selected face's module grid, or the picked string, and where a drag's steps go. */
export type Painting =
  | (Steps & {
      readonly kind: "modules";
      /** By position in the scene's grids. */
      readonly grid: number;
      /** The roofs and every grid's cells, as the crate lays them out. */
      readonly laid: Pick<Modules, "roofs" | "grids">;
      /** The cells free to place a module in. */
      readonly free: readonly CellPlace[];
      /** The selected module's cell. */
      readonly selected?: CellPlace | undefined;
      /** A tap on a module of the grid. */
      readonly onselect: (at: At) => void;
    })
  | (Steps & {
      readonly kind: "string";
      /** By position in the draft's strings. */
      readonly string: number;
      /** Its modules' centres along its wiring. */
      readonly path: readonly Point[];
    });

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

/** A cell under the pointer: its grid, its cell, and both as one key. */
interface Under {
  readonly grid: number;
  readonly at: At;
  readonly key: string;
  /** A module lies in it. */
  readonly module: boolean;
}

interface Held {
  readonly pointer: number;
  readonly stroke: Stroke;
  readonly from: Scene;
  /** Where the pointer is now, for the orbit controls if a second finger comes. */
  at: readonly [number, number];
  last: string;
  /** A press on a module that has not left it yet: a tap selects it, a drag erases. */
  pending: Under | undefined;
}

const under = (grid: number, at: At, module: boolean): Under => ({
  grid,
  at,
  module,
  key: `${grid}.${at.row}.${at.column}`,
});

/** A module the strike landed on, on any face. */
function moduleUnder(hit: Hit): Under | null {
  return hit.kind === "grid" && hit.cell !== undefined ? under(hit.grid, hit.cell, true) : null;
}

/** A module of the selected face's grid, or the free cell of it whose roof the strike landed on,
 * found as the inspector's picking finds a face. */
function laidUnder(painting: Extract<Painting, { kind: "modules" }>, hit: Hit): Under | null {
  if (hit.kind === "grid") {
    const module = moduleUnder(hit);

    return module?.grid === painting.grid ? module : null;
  }

  const cell = hit.kind === "point" ? cellAt(painting.draft.scene, painting.laid, hit.point) : null;

  return cell?.grid === painting.grid ? under(cell.grid, cell, false) : null;
}

/** What a stroke does: wire the picked string, or place and remove modules. */
function toolOf(painting: Painting): Tool {
  return painting.kind === "string"
    ? { kind: "paint", string: painting.string }
    : { kind: "place" };
}

/** Listens on a canvas, before the orbit controls and the click picking. */
export class Brush {
  readonly #canvas: HTMLCanvasElement;
  readonly #camera: PerspectiveCamera;
  readonly #sources: Brushing;
  #held: Held | undefined;

  readonly #handover = new Handover();

  /** Stops listening. */
  readonly dispose: () => void;

  constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera, sources: Brushing) {
    this.#canvas = canvas;
    this.#camera = camera;
    this.#sources = sources;
    this.dispose = listen(canvas, { press: this.#press, move: this.#move, release: this.#release });
  }

  /** The module, or for a selected face the free cell, under the pointer. */
  #under(event: PointerEvent, painting: Painting): Under | null {
    const group = this.#sources.drawn();

    if (group === undefined) return null;

    // A press may come before the first draw has placed the camera's matrices.
    this.#camera.updateMatrixWorld();

    const hit = strike(group, this.#sources.panels(), this.#camera, ndc(this.#canvas, event));

    if (hit === null) return null;

    return painting.kind === "string" ? moduleUnder(hit) : laidUnder(painting, hit);
  }

  /** Paints one cell, or answers beside the pointer why its grid refuses the string. */
  #paint(painting: Painting, stroke: Stroke, event: PointerEvent, cell: Under): void {
    if (refuses(painting.draft, cell.grid, stroke)) {
      const box = this.#canvas.getBoundingClientRect();
      const name = painting.kind === "string" ? painting.draft.strings[painting.string]?.name : "";

      haptics.error();
      this.#sources.onrefuse({
        text: m.builder_refused_module_type({ name: name ?? "" }),
        left: event.clientX - box.left,
        top: event.clientY - box.top,
      });

      return;
    }

    haptics.selection();
    painting.ondrag(paint(painting.draft.scene, cell.grid, cell.at, stroke));
  }

  readonly #press = (event: PointerEvent): void => {
    if (this.#handover.handed(event)) return;

    if (this.#held !== undefined) {
      this.#another(event, this.#held);

      return;
    }

    const painting = this.#sources.painting();
    const cell = painting && event.button === 0 ? this.#under(event, painting) : null;

    if (painting !== undefined && cell !== null) this.#start(event, painting, cell);
  };

  /** Another pointer during a drag: a second finger hands both to the orbit controls; anything
   * else is kept from them. */
  #another(event: PointerEvent, held: Held): void {
    if (event.pointerType === "touch") this.#handOver(held);
    else event.stopImmediatePropagation();
  }

  /** A press on `cell` starts a stroke; one on a module of the face waits, as a tap selects it. */
  #start(event: PointerEvent, painting: Painting, cell: Under): void {
    // The orbit controls and the click picking never see it.
    event.stopImmediatePropagation();
    this.#canvas.setPointerCapture(event.pointerId);
    this.#sources.onrefuse();

    const stroke = strokeOf(painting.draft.scene, cell.grid, cell.at, toolOf(painting));
    const pending = painting.kind === "modules" && cell.module ? cell : undefined;

    this.#held = {
      pointer: event.pointerId,
      stroke,
      from: painting.draft.scene,
      at: [event.clientX, event.clientY],
      last: cell.key,
      pending,
    };

    if (pending === undefined) this.#paint(painting, stroke, event, cell);
  }

  readonly #move = (event: PointerEvent): void => {
    const held = this.#held;
    const painting = this.#sources.painting();

    if (held?.pointer !== event.pointerId || painting === undefined) return;

    event.stopImmediatePropagation();
    held.at = [event.clientX, event.clientY];

    const cell = this.#under(event, painting);

    if (cell === null || cell.key === held.last) return;

    held.last = cell.key;

    if (held.pending !== undefined) {
      this.#paint(painting, held.stroke, event, held.pending);
      held.pending = undefined;
    }

    this.#paint(this.#sources.painting() ?? painting, held.stroke, event, cell);
  };

  /** Puts the scene back, unrecorded, and presses the first finger again where it is now, for the
   * orbit controls; the second finger's press follows it there. */
  #handOver(held: Held): void {
    const painting = this.#sources.painting();

    this.#held = undefined;
    painting?.ondrag(held.from);
    painting?.ondrop();

    this.#handover.give(this.#canvas, held.pointer, held.at);
  }

  readonly #release = (event: PointerEvent): void => {
    if (this.#held?.pointer === event.pointerId) this.#letGo(event, this.#held);
  };

  /** Let go: a tap on a module selects it, a stroke is one undo step. */
  #letGo(event: PointerEvent, held: Held): void {
    event.stopImmediatePropagation();
    this.#held = undefined;

    const painting = this.#sources.painting();

    if (held.pending !== undefined && painting?.kind === "modules" && event.type === "pointerup") {
      haptics.soft();
      painting.onselect(held.pending.at);

      return;
    }

    painting?.ondrop();
  }
}
