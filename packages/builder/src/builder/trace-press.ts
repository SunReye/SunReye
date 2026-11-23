// The tracing mode's pointer on a canvas (ADR 20): a press is the tracing's, before the handles,
// the orbit controls and the click picking, unless a second finger comes, which hands the canvas
// to the orbit controls. A tap clicks; a drag from a traced line moves it; a finger's drag
// clicks where it lets go. Escape ends the chain.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { PerspectiveCamera } from "three";
import { projector } from "./project.ts";
import { aim, pvPoint, type Aimed } from "./trace-aim.ts";
import { pick } from "./trace-pick.ts";
import { Handover, listen } from "./pointer.ts";
import type { TraceTool, Tracing } from "./tracing.svelte.ts";

/** Pixels a click snaps within by default. */
const REACH = 12;

/** Further than this many pixels from its press, a pointer dragged. */
const TAP = 5;

interface Held {
  readonly pointer: number;
  readonly down: readonly [number, number];
  dragged: boolean;
}

export class TracePress {
  readonly #canvas: HTMLCanvasElement;
  readonly #camera: PerspectiveCamera;
  readonly #tool: TraceTool;
  readonly #tracing: () => Tracing | undefined;
  readonly #handover = new Handover();
  #held: Held | undefined;

  /** Stops listening. */
  readonly dispose: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    camera: PerspectiveCamera,
    tool: TraceTool,
    tracing: () => Tracing | undefined,
  ) {
    this.#canvas = canvas;
    this.#camera = camera;
    this.#tool = tool;
    this.#tracing = tracing;

    const unlisten = listen(canvas, {
      press: this.#press,
      move: this.#move,
      release: this.#release,
    });

    canvas.addEventListener("pointerleave", this.#leave);
    window.addEventListener("keydown", this.#key);
    this.dispose = () => {
      unlisten();
      canvas.removeEventListener("pointerleave", this.#leave);
      window.removeEventListener("keydown", this.#key);
    };
  }

  /** Where `event` aims, and what of the traced roof it picks as drawn. */
  #aim(event: PointerEvent, tracing: Tracing): Aimed | null {
    const { scene } = tracing;
    const pixels = tracing.reach ?? REACH;
    const aimed = aim(this.#canvas, this.#camera, scene.north, event, pixels);
    const project = projector(this.#canvas, this.#camera);
    const box = this.#canvas.getBoundingClientRect();
    const pointer = [event.clientX - box.left, event.clientY - box.top] as const;

    if (aimed === null) return null;

    const picked = pick(scene, (spot) => project(pvPoint(scene.north, spot)), pointer, pixels);

    return { ...aimed, snap: picked ?? { kind: "free", at: aimed.at } };
  }

  readonly #press = (event: PointerEvent): void => {
    const tracing = this.#tracing();

    if (this.#handover.handed(event) || tracing === undefined || event.button !== 0) return;

    if (this.#held !== undefined) {
      this.#another(event);

      return;
    }

    const aimed = this.#aim(event, tracing);

    if (aimed === null) return;

    event.stopImmediatePropagation();
    this.#canvas.setPointerCapture(event.pointerId);
    this.#tool.press(tracing, aimed);
    this.#held = { pointer: event.pointerId, down: [event.clientX, event.clientY], dragged: false };
  };

  /** A second finger hands the canvas to the orbit controls: the press is put back. */
  #another(event: PointerEvent): void {
    const held = this.#held;

    if (held === undefined || event.pointerType !== "touch") {
      event.stopImmediatePropagation();

      return;
    }

    this.#held = undefined;
    this.#tool.abort();
    this.#handover.give(this.#canvas, held.pointer, held.down);
  }

  readonly #move = (event: PointerEvent): void => {
    const tracing = this.#tracing();
    const held = this.#held;

    if (tracing === undefined || (held !== undefined && held.pointer !== event.pointerId)) return;

    if (held !== undefined) {
      event.stopImmediatePropagation();
      held.dragged ||= Math.hypot(event.clientX - held.down[0], event.clientY - held.down[1]) > TAP;
    }

    const box = this.#canvas.getBoundingClientRect();
    const aimed = this.#aim(event, tracing);

    this.#tool.point([event.clientX - box.left, event.clientY - box.top]);

    if (aimed !== null) this.#tool.move(tracing, aimed, held?.dragged === true);
  };

  readonly #release = (event: PointerEvent): void => {
    const held = this.#held;
    const tracing = this.#tracing();

    if (held?.pointer !== event.pointerId || tracing === undefined) return;

    event.stopImmediatePropagation();
    this.#held = undefined;

    const aimed = event.type === "pointerup" ? this.#aim(event, tracing) : null;

    if (aimed === null) this.#tool.abort();
    else this.#tool.release(tracing, aimed, held.dragged, event.pointerType === "touch");
  };

  readonly #leave = (): void => {
    if (this.#held === undefined) this.#tool.point();
  };

  readonly #key = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.#tool.end();
  };
}
