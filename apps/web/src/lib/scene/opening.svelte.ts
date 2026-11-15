// When a studio draws (ADR 20): once per frame on a change and while the camera flies, never in a
// loop, and nothing before it is prepared, so the first frame never waits on a compile. Ported
// from the prototype's background load.
import { motion } from "../motion/tier.svelte.ts";
import { Flight } from "./flight.ts";
import { ahead, gpuIdle, nextFrame, pause, prepare } from "./prepare.ts";
import type { Ghost } from "./stage.svelte.ts";
import type { Studio } from "./studio.ts";
import { idle } from "./warm.ts";

/** A burst frame slower than this ends the burst: three frames at 60 Hz. */
const BURST_FRAME_MS = 50;

export class Opening {
  readonly #studio: Studio;
  /** The camera's flight to a new view; it lands at once on the still tier. */
  readonly flight = new Flight(() => motion.still);
  readonly #drawn: () => void;
  #frame = 0;
  /** The pending frame of a settled picture's refining burst (ADR 20 Rendering quality). */
  #refining = 0;
  /** Counts the bursts begun and ended, so a frame can tell its own is still the current one. */
  #burst = 0;
  #held = true;
  #gone = false;
  #later: ReturnType<typeof setTimeout> | undefined;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  constructor(studio: Studio, drawn: () => void) {
    this.#studio = studio;
    this.#drawn = drawn;
  }

  /** Draws in the next frame, unless held. */
  readonly render = (): void => {
    if (this.#held) return;

    // The picture is about to change: what refined the last one is void.
    this.#rest();
    this.#frame ||= requestAnimationFrame((now) => {
      const flying = this.flight.step(now);

      // Where the flight moved the camera is drawn in this frame, not the next.
      this.#frame = 0;
      this.#draw();

      if (flying) this.render();
    });
  };

  /** Once `built`, prepares, draws the first frame, calls `ready` once it is drawn, and `due`
   * when idle after. */
  // fallow-ignore-next-line unused-class-member -- SceneCanvas calls it through `Lit["opening"]`.
  async open(built: Readonly<Promise<void>>, ready: () => void, due: () => void): Promise<void> {
    await built;
    await pause();

    if (this.#gone || !(await prepare(this.#studio, this.#isGone))) return;

    this.#held = false;
    this.#draw();
    // Not before the GPU has drawn it: a fade over a frame still rasterising is a cut.
    await gpuIdle(this.#studio.renderer);
    await nextFrame();

    if (this.#gone) return;

    ready();
    // After the fade, when nothing else is waiting.
    this.#later = setTimeout(() => {
      idle(due, 2000);
    }, 450);
  }

  /** Runs `park`, its programs compiled first; on screen, the change fades in. */
  /* oxlint-disable typescript/prefer-readonly-parameter-types -- the canvas is drawn on. */
  // fallow-ignore-next-line unused-class-member -- SceneCanvas calls it through `Lit["opening"]`.
  async arrive(canvas: HTMLCanvasElement, ghost: Ghost, park: () => void): Promise<void> {
    const fade = !motion.still && !this.flight.flying && ghost.canvas !== undefined;

    this.#hold(true);

    if (fade) {
      // Drawn and taken in one task, while the canvas still holds the frame.
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
    clearTimeout(this.#later);
    cancelAnimationFrame(this.#frame);
    this.#rest();
  }

  readonly #isGone = (): boolean => this.#gone;

  #draw(): void {
    this.#studio.render();
    this.#drawn();
    this.#rest();
    this.#refine();
  }

  /** A frame of the burst in each of the next frames, until the studio has had its fill, the
   * picture changes, or the GPU takes long over one: a device that cannot hold the burst keeps
   * the picture it has. Where the look has no burst, none is asked for. */
  #refine(): void {
    const burst = (this.#burst += 1);

    this.#refining = requestAnimationFrame((start) => {
      this.#refining = 0;

      if (this.#held || this.#gone || !this.#studio.refine()) return;

      // Not before the GPU has drawn it: frames queued faster than they are drawn pile up.
      void gpuIdle(this.#studio.renderer).then(() => {
        const held = performance.now() - start < BURST_FRAME_MS;

        if (held && burst === this.#burst) this.#refine();
      });
    });
  }

  /** Ends the burst: a frame of it still on the GPU starts no other. */
  #rest(): void {
    this.#burst += 1;
    cancelAnimationFrame(this.#refining);
    this.#refining = 0;
  }

  #hold(on: boolean): void {
    this.#held = on;

    if (!on) this.render();
  }
}
