// Ultra's refining burst as frames (ADR 20 Rendering quality): once a picture has settled, one
// more frame of it in each of the display's, until the studio has had its fill.
import { gpuIdle } from "./prepare.ts";
import type { Studio } from "./studio.ts";

/** A burst frame slower than this ends the burst: three frames at 60 Hz. */
const BURST_FRAME_MS = 50;

export class Burst {
  readonly #studio: Studio;
  readonly #held: () => boolean;
  /** The pending frame of a settled picture's burst. */
  #frame = 0;
  /** Counts the bursts begun and ended, so a frame can tell its own is still the current one. */
  #burst = 0;

  /** Refines what `studio` drew; no frame of it is drawn while `held`. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  constructor(studio: Studio, held: () => boolean) {
    this.#studio = studio;
    this.#held = held;
  }

  /** A frame of the burst in each of the next frames, until the studio has had its fill, the
   * picture changes, or the GPU takes long over one: a device that cannot hold the burst keeps
   * the picture it has. Where the look has no burst, none is asked for. */
  start(): void {
    const burst = (this.#burst += 1);

    this.#frame = requestAnimationFrame((start) => {
      this.#frame = 0;

      if (this.#held() || !this.#studio.refine()) return;

      void this.#next(burst, start);
    });
  }

  /** Ends the burst: a frame of it still on the GPU starts no other. */
  rest(): void {
    this.#burst += 1;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  /** The burst's next frame, once the GPU has drawn the one begun at `start`, and in time. */
  async #next(burst: number, start: number): Promise<void> {
    // Not before the GPU has drawn it: frames queued faster than they are drawn pile up.
    await gpuIdle(this.#studio.renderer);

    if (performance.now() - start < BURST_FRAME_MS && burst === this.#burst) this.start();
  }
}
