/**
 * The 3D quality as reactive state: the rune shell over `./quality`. The choice, the GPU last
 * seen and the levels strain has taken off Auto are kept per browser (ADR 20 Look).
 */
import { forget, read, write } from "../kept.ts";
import { STRAINED_AT, strainLeft, type MotionTier } from "../motion/tier.ts";
import {
  capable,
  drawn,
  MAX_STEPS,
  parseQuality,
  parseSteps,
  relief,
  type Look,
  type Quality,
} from "./quality.ts";

/** Where each browser keeps its 3D quality. */
export const QUALITY = "sunreye.3d-quality";

const STEPS = "sunreye.3d-strain";
const GPU = "sunreye.gpu";

export class QualityStore {
  readonly #now: () => number;
  #choice = $state(parseQuality(read(QUALITY)));
  #steps = $state(0);
  #gpu = $state(read(GPU));
  /** Studios on show: only a strain measured over a drawn scene says anything about its cost.
   * Asked when a strain is measured, never rendered: plain, so a studio's set-up tracks nothing. */
  #shown = 0;

  /** `now` dates a strain: it lasts seven days (ADR 21). */
  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
    this.#steps = strainLeft(read(STRAINED_AT), now()) > 0 ? parseSteps(read(STEPS)) : 0;
  }

  get choice(): Quality {
    return this.#choice;
  }

  /** Kept per browser. */
  set choice(next: Quality) {
    this.#choice = next;
    write(QUALITY, next);
  }

  /** What a studio draws on `tier`. */
  look(tier: MotionTier): Look {
    return drawn(this.#choice, this.#device(tier));
  }

  /** WebGL2's unmasked renderer, as a studio's context reports it; kept for the next visit. */
  see(gpu: string | null): void {
    if (gpu === null || gpu === this.#gpu) return;

    this.#gpu = gpu;
    write(GPU, gpu);
  }

  /** A studio is on show until the disposer runs. */
  show(): () => void {
    this.#shown += 1;
    let released = false;

    return () => {
      if (released) return;

      released = true;
      this.#shown -= 1;
    };
  }

  /** Whether a strain measured on `tier` would take a level off the drawing. */
  relieves(tier: MotionTier): boolean {
    return this.#shown > 0 && relief(this.#choice, this.#device(tier));
  }

  /** Whether strain has taken a level off Auto. */
  get stepped(): boolean {
    return this.#steps > 0;
  }

  /** Neu messen (ADR 21): forgets the levels strain took off Auto. */
  remeasure(): void {
    this.#steps = 0;
    forget(STEPS);
  }

  /** Takes a level off Auto for a strain measured on `tier`; false when the tier must give. */
  relieve(tier: MotionTier): boolean {
    if (!this.relieves(tier)) return false;

    this.#steps = Math.min(MAX_STEPS, this.#steps + 1);
    write(STEPS, String(this.#steps));
    write(STRAINED_AT, String(this.#now()));

    return true;
  }

  #device(tier: MotionTier) {
    return { capable: capable(this.#gpu), steps: this.#steps, tier };
  }
}

export const quality = new QualityStore();
