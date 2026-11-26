// The tracing mode's pointer on a canvas (ADR 20): a press is the tracing's, before the handles,
// the orbit controls and the click picking, unless a second finger comes, which hands the canvas
// to the orbit controls. A tap clicks; a drag from a traced line moves it; a finger's drag
// clicks where it lets go. Escape ends the chain.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Object3D } from "three";
import type { Lens } from "./lens.ts";
import { aim, type Aimed } from "./trace-aim.ts";
import { pick } from "./trace-pick.ts";
import { seenOnscreen } from "./trace-sight.ts";
import { Handover, listen } from "./pointer.ts";
import { spaceHeld } from "./space.ts";
import type { TraceTool, Tracing } from "./tracing.svelte.ts";

/** Pixels a click snaps within by default. */
const REACH = 12;

/** Further than this many pixels from its press, a pointer dragged. */
const TAP = 5;

interface Held {
  readonly pointer: number;
  readonly down: readonly [number, number];
  /** The height of the traced point or line pressed, whose level the drag moves on. */
  readonly height: number;
  dragged: boolean;
}

/** Not drawing, a press on nothing traced is the picking's and the camera's. */
function leftToPicking(tracing: Tracing, aimed: Aimed): boolean {
  return tracing.drawing === false && aimed.snap?.kind === "free";
}

/** The height of the traced point or line `aimed` picks; the ground's for none. */
function grabbedHeight(aimed: Aimed | null): number {
  const snap = aimed?.snap;

  return snap === undefined || snap.kind === "free" ? 0 : (snap.at[1] ?? 0);
}

export class TracePress {
  readonly #canvas: HTMLCanvasElement;
  readonly #camera: Lens;
  readonly #tool: TraceTool;
  readonly #tracing: () => Tracing | undefined;
  readonly #house: () => Object3D | undefined;
  readonly #handover = new Handover();
  #held: Held | undefined;

  /** Stops listening. */
  readonly dispose: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    camera: Lens,
    tool: TraceTool,
    tracing: () => Tracing | undefined,
    house: () => Object3D | undefined,
  ) {
    this.#canvas = canvas;
    this.#camera = camera;
    this.#tool = tool;
    this.#tracing = tracing;
    this.#house = house;

    const unlisten = listen(canvas, {
      press: this.#press,
      move: this.#move,
      release: this.#release,
    });

    canvas.addEventListener("pointerleave", this.#leave);
    canvas.addEventListener("dblclick", this.#double);
    // Before the page's own keys: a Del or Esc the tracing acts on is not theirs too.
    window.addEventListener("keydown", this.#key, true);
    this.dispose = () => {
      unlisten();
      canvas.removeEventListener("pointerleave", this.#leave);
      canvas.removeEventListener("dblclick", this.#double);
      window.removeEventListener("keydown", this.#key, true);
    };
  }

  /** Where `event` aims, on the level of what is held, and what of the traced roof it picks as
   * drawn. */
  #aim(event: MouseEvent, tracing: Tracing, height = this.#held?.height ?? 0): Aimed | null {
    const { scene } = tracing;
    const pixels = tracing.reach ?? REACH;
    const aimed = aim(this.#canvas, this.#camera, scene.north, event, [pixels, height]);
    const box = this.#canvas.getBoundingClientRect();
    const pointer = [event.clientX - box.left, event.clientY - box.top] as const;

    if (aimed === null) return null;

    // What the house hides from a 3D camera is never grabbed.
    const onscreen = seenOnscreen(this.#canvas, this.#camera, this.#house(), scene.north);
    const picked = pick(scene, onscreen, pointer, pixels);

    return {
      ...aimed,
      snap: picked ?? { kind: "free", at: aimed.at },
      free: event.shiftKey,
      level: event.altKey,
    };
  }

  readonly #press = (event: PointerEvent): void => {
    const tracing = this.#tracing();

    const passed = this.#handover.handed(event) || tracing === undefined || event.button !== 0;

    if (passed || spaceHeld()) return;

    if (this.#held !== undefined) {
      this.#another(event);

      return;
    }

    const height = grabbedHeight(this.#aim(event, tracing));
    const aimed = this.#aim(event, tracing, height);

    if (aimed === null || leftToPicking(tracing, aimed)) return;

    event.stopImmediatePropagation();
    this.#canvas.setPointerCapture(event.pointerId);
    this.#tool.press(tracing, aimed);
    this.#held = {
      pointer: event.pointerId,
      down: [event.clientX, event.clientY],
      height,
      dragged: false,
    };
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

    const aimed = event.type === "pointerup" ? this.#aim(event, tracing, held.height) : null;

    if (aimed === null) this.#tool.abort();
    else this.#tool.release(tracing, aimed, held.dragged, event.pointerType === "touch");
  };

  readonly #leave = (): void => {
    if (this.#held === undefined) this.#tool.point();
  };

  /** A double click puts a point into the traced line under it. */
  readonly #double = (event: MouseEvent): void => {
    const tracing = this.#tracing();
    const aimed = tracing && this.#aim(event, tracing);

    if (tracing && aimed) this.#tool.split(tracing, aimed);
  };

  readonly #key = (event: KeyboardEvent): void => {
    const tracing = this.#tracing();

    if (tracing === undefined) return;

    const removing = event.key === "Delete" || event.key === "Backspace";

    const acted =
      (event.key === "Escape" && this.#tool.escape(tracing)) ||
      (removing && this.#tool.removeTapped(tracing));

    if (acted) event.stopPropagation();
  };
}
