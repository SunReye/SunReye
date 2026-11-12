// When a studio draws (ADR 20): once per frame on a change and while the camera flies, never in a
// loop, and nothing before it is prepared, so the first frame never waits on a compile. Ported
// from the prototype's background load.
import { motion } from "../motion/tier.svelte.ts";
import { Flight } from "./flight.ts";
import { ahead, gpuIdle, nextFrame, pause, prepare } from "./prepare.ts";
import type { Ghost } from "./stage.svelte.ts";
import type { Studio } from "./studio.ts";
import { idle } from "./warm.ts";

export class Opening {
  readonly #studio: Studio;
  /** The camera's flight to a new view; it lands at once on the still tier. */
  readonly flight = new Flight(() => motion.still);
  readonly #drawn: () => void;
  #frame = 0;
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

    this.#frame ||= requestAnimationFrame((now) => {
      const flying = this.flight.step(now);

      // Where the flight moved the camera is drawn in this frame, not the next.
      this.#frame = 0;
      this.#draw();

      if (flying) this.render();
    });
  };

  /** Prepares, draws the first frame, calls `ready` once it is drawn, and `due` when idle after. */
  // fallow-ignore-next-line unused-class-member -- SceneCanvas calls it through `Lit["opening"]`.
  async open(ready: () => void, due: () => void): Promise<void> {
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
  }

  readonly #isGone = (): boolean => this.#gone;

  #draw(): void {
    this.#studio.render();
    this.#drawn();
  }

  #hold(on: boolean): void {
    this.#held = on;

    if (!on) this.render();
  }
}
