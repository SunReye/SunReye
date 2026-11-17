// How the lens glass comes and goes (ADR 23 "Scene weather"): it fades in and out with the
// weather, by the weather loop's seconds. Pure: the pass that draws it is `./lens-pass.ts`.
import type { Glass } from "./weather.ts";

/** Seconds from a clear lens to a whole one. */
const FADE = 3;

const NONE: Glass = { rain: 0, snow: 0, frost: 0 };

/** `shown` a step of at most `by` nearer `target`. */
const nearer = (shown: number, target: number, by: number): number =>
  shown + Math.min(by, Math.max(-by, target - shown));

export class Fade {
  #target = NONE;
  #shown = NONE;
  /** The loop's second it was last moved at; undefined while it stands clear. */
  #moved: number | undefined;

  /** Whether nothing is on the lens and nothing is to come. */
  get clear(): boolean {
    return this.#target === NONE && this.#shown === NONE;
  }

  /** Fades toward `target`; null clears the lens. */
  aim(target: Glass | null): void {
    this.#target = target ?? NONE;
  }

  /** Clears the lens at once. */
  cut(): void {
    this.#target = NONE;
    this.#shown = NONE;
    this.#moved = undefined;
  }

  /** What is on the lens at `seconds` of the loop; null once it is clear. */
  at(seconds: number): Glass | null {
    const by = Math.max(0, seconds - (this.#moved ?? seconds)) / FADE;
    const { rain, snow, frost } = this.#shown;

    const shown = {
      rain: nearer(rain, this.#target.rain, by),
      snow: nearer(snow, this.#target.snow, by),
      frost: nearer(frost, this.#target.frost, by),
    };

    const left = shown.rain + shown.snow + shown.frost > 0;

    this.#shown = left ? shown : NONE;
    // Clear, it stands: the next fade starts at its own first frame.
    this.#moved = this.clear ? undefined : seconds;

    return left ? shown : null;
  }
}
