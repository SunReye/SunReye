// When a studio draws (ADR 20): once per frame on a change and while the camera flies or a tint
// glides, in a loop only while the weather's moves (ADR 23 "Motion"), every frame held to the
// frame limit (ADR 21), and nothing before it is prepared, so the first frame never waits on a
// compile. Ported from the prototype's background load.
import { motion } from "../motion/tier.svelte.ts";
import { Burst } from "./burst.ts";
import { Flight } from "./flight.ts";
import { frameLimit } from "./frame-limit.svelte.ts";
import { Loop, pauseUnseen } from "./loop.ts";
import { ahead, gpuIdle, nextFrame, pause, prepare } from "./prepare.ts";
import type { Ghost } from "./stage.svelte.ts";
import type { Studio } from "./studio.ts";
import { idle } from "./warm.ts";
import { weatherMoves, type Moving } from "./weather-moves.svelte.ts";

export class Opening {
  readonly #studio: Studio;
  /** The camera's flight to a new view; it lands at once on the still tier. */
  readonly flight = new Flight(() => motion.still);
  readonly #drawn: () => void;
  #frame = 0;
  /** A settled picture's refining burst (ADR 20 Rendering quality). */
  readonly #burst: Burst;
  #held = true;
  #gone = false;
  #later: ReturnType<typeof setTimeout> | undefined;
  /** A change waits for the loop's next frame: the picture is not the last one moved on. */
  #changed = false;
  /** Holds every frame drawn here to this browser's frame limit (ADR 21). */
  readonly #pace = frameLimit.pace();
  /** What moves besides the flight, each stepped in a drawn frame until it says it rests. */
  readonly #moving = new Set<(now: number) => boolean>();
  readonly #unwatch: () => void;
  /** Lets the loop go of what moved with the weather. */
  #unmove: (() => void) | undefined;
  /** The frame watch's leave of its idle watch while the loop runs. */
  #looping: (() => void) | undefined;
  /** Told once the first frame is drawn, or never will be: the frame watch settles from then. */
  readonly #settle: () => void;

  /**
   * The weather loop (ADR 23 "Motion"): the one loop this studio is drawn in. What moves keeps
   * it running with `keep`, and it draws while anything is kept, the picture is prepared, the
   * tier is full, the tab is shown and the canvas is on screen, in every frame the frame limit
   * allows. Every change asked for with `render` is drawn in its frames while it runs.
   */
  readonly loop: Loop = new Loop({
    frames: {
      request: (frame) => requestAnimationFrame(frame),
      cancel: (id) => {
        cancelAnimationFrame(id);
      },
    },
    due: (now) => this.#pace.take(now),
    draw: (now) => {
      this.#paint(now);
    },
    count: (now) => {
      motion.frame(now);
    },
    // The frame watch judges the loop by its own frames while it runs (ADR 21).
    started: () => {
      this.#looping = motion.loop();
    },
    // One frame more: it places the labels and starts the burst the loop's frames went without.
    stopped: () => {
      this.#looping?.();
      this.#changed = false;
      this.render();
    },
  });

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  constructor(studio: Studio, drawn: () => void, settle: () => void) {
    this.#studio = studio;
    this.#drawn = drawn;
    this.#settle = settle;
    this.#burst = new Burst(studio, () => this.#held || this.#gone);
    this.loop.pause("held", true);
    this.#unwatch = pauseUnseen(this.loop, studio.renderer.domElement);
  }

  /** Draws in the next frame, unless held. */
  readonly render = (): void => {
    if (this.#held || this.#gone) return;

    // The picture is about to change: what refined the last one is void.
    this.#burst.rest();

    // One frame, one draw: the loop's own is the next.
    if (this.loop.running) {
      this.#changed = true;

      return;
    }

    this.#frame ||= requestAnimationFrame((now) => {
      this.#frame = 0;

      // Not in this frame, by the limit: the next one allowed draws what changed.
      if (!this.#pace.take(now)) {
        this.render();

        return;
      }

      this.#changed = true;

      if (this.#paint(now)) this.render();
    });
  };

  /** Steps `step` in each frame drawn, the loop's or its own, until it returns false: a tint's
   * glide (ADR 20 Motion). The release ends it early. */
  animate(step: (now: number) => boolean): () => void {
    this.#moving.add(step);
    this.render();

    return () => {
      this.#moving.delete(step);
    };
  }

  /** What casts a shadow changed, as when a car parks: draws in the next frame, the sun's shadow
   * map with it (ADR 20 Rendering). */
  readonly recast = (): void => {
    this.#studio.recast();
    this.render();
  };

  /** Shows what moves with the `weather`, read as it changes (ADR 23): what falls and the lens
   * glass, each in the loop while it moves. Call during a component's set-up. */
  moves(weather: Moving): void {
    this.#unmove = weatherMoves(this.#studio, this.loop, this.render, weather);
  }

  /** Once `built`, prepares, draws the first frame, calls `ready` once it is drawn, and `due`
   * when idle after. */
  async open(built: Readonly<Promise<void>>, ready: () => void, due: () => void): Promise<void> {
    try {
      await this.#first(built);
    } finally {
      this.#settle();
    }

    if (this.#gone || this.#held) return;

    ready();
    // After the fade, when nothing else is waiting.
    this.#later = setTimeout(() => {
      idle(due, 2000);
    }, 450);
  }

  /** Prepares and draws the first frame; held still if it could not be. */
  async #first(built: Readonly<Promise<void>>): Promise<void> {
    await built;
    await pause();

    if (this.#gone || !(await prepare(this.#studio, this.#isGone))) return;

    this.#held = false;
    this.loop.pause("held", false);
    this.#changed = true;
    this.#draw();
    // Not before the GPU has drawn it: a fade over a frame still rasterising is a cut.
    await gpuIdle(this.#studio.renderer);
    await nextFrame();
  }

  /** Runs `park`, its programs compiled first; on screen, the change fades in. */
  /* oxlint-disable typescript/prefer-readonly-parameter-types -- the canvas is drawn on. */
  async arrive(canvas: HTMLCanvasElement, ghost: Ghost, park: () => void): Promise<void> {
    const fade = !motion.still && !this.flight.flying && ghost.canvas !== undefined;

    this.#hold(true);

    if (fade) {
      // Drawn and taken in one task, while the canvas still holds the frame.
      this.#changed = true;
      this.#draw();

      const still = await createImageBitmap(canvas);

      ghost.canvas?.getContext("bitmaprenderer")?.transferFromImageBitmap(still);
      ghost.phase = "hold";
    }

    park();

    const compiled = await ahead(this.#studio, this.#isGone).catch(() => true);

    this.#hold(false);

    if (!compiled || !fade) return;

    // The frame with the cars is on the canvas before the held picture goes.
    await nextFrame();
    await gpuIdle(this.#studio.renderer);
    await nextFrame();

    if (ghost.phase === "hold") ghost.phase = "fade";
  }

  /* oxlint-enable typescript/prefer-readonly-parameter-types */

  dispose(): void {
    this.#gone = true;
    this.#unwatch();
    this.loop.pause("gone", true);
    this.#unmove?.();
    clearTimeout(this.#later);
    cancelAnimationFrame(this.#frame);
    this.#burst.rest();
  }

  readonly #isGone = (): boolean => this.#gone;

  /** A frame at `now`: where the flight moved the camera, and what else moves, is drawn in it,
   * not the next. True while anything goes on. */
  #paint(now: number): boolean {
    let moving = this.flight.step(now);

    for (const step of this.#moving) {
      if (step(now)) moving = true;
      else this.#moving.delete(step);
    }

    this.#changed ||= moving;
    this.#draw();

    return moving;
  }

  /** Draws; `drawn` hears of a changed picture alone, and not of rain that fell on. */
  #draw(): void {
    const changed = this.#changed;

    this.#changed = false;
    this.#studio.render();

    if (changed) this.#drawn();

    this.#burst.rest();

    // A picture that moves on with the next frame is never settled.
    if (!this.loop.running) this.#burst.start();
  }

  #hold(on: boolean): void {
    this.#held = on;
    // Paused, it stops and asks for a frame, which waits while held; resumed, it draws.
    this.loop.pause("held", on);

    if (!on) this.render();
  }
}
