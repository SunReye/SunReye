// The frame limit as reactive state (ADR 21 "Frame limit"): the rune shell over `./frame-limit`.
// Kept per browser, and read by every scene with each frame.
import { read, write } from "../kept.ts";
import {
  FRAME_LIMIT,
  frameInterval,
  Pace,
  parseFrameLimit,
  type FrameLimit,
} from "./frame-limit.ts";

class FrameLimitStore {
  #choice = $state(parseFrameLimit(read(FRAME_LIMIT)));

  get choice(): FrameLimit {
    return this.#choice;
  }

  /** Kept per browser; it holds from a scene's next frame. */
  set choice(next: FrameLimit) {
    this.#choice = next;
    write(FRAME_LIMIT, next);
  }

  /** A pace for one scene: it holds what draws there to the limit of the moment. */
  pace(): Pace {
    return new Pace(() => frameInterval(this.#choice));
  }
}

export const frameLimit = new FrameLimitStore();
