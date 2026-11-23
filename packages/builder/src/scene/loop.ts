// The weather loop (ADR 23 "Motion"): the one loop the scene draws in, and only while something
// that moves is kept on show. It draws at the display's rate, held to the frame limit, never
// while paused, and every frame the display gives is counted for the frame watch (ADR 21). The
// frames are handed in.

/** The display's frames, as `requestAnimationFrame` gives them. */
export interface Frames {
  readonly request: (frame: (now: number) => void) => number;
  readonly cancel: (id: number) => void;
}

export interface Looped {
  readonly frames: Frames;
  /** Whether the frame at `now` may be drawn in: the frame limit's say (ADR 21). */
  readonly due: (now: number) => boolean;
  /** Draws the scene at the frame's `now`. */
  readonly draw: (now: number) => void;
  /** Told of every frame the display gives while the loop runs, drawn in or not. */
  readonly count: (now: number) => void;
  /** The loop draws from here on, until `stopped`. */
  readonly started: () => void;
  /** The loop has stopped or paused: the picture it leaves is settled by whoever draws on. */
  readonly stopped: () => void;
}

/** What moves in the loop: told the seconds the loop has run, before each frame it draws. */
export type Step = (seconds: number) => void;

/** The most the loop's clock moves in one frame: a stall is not a leap. */
const LONGEST = 100;

export class Loop {
  readonly #on: Looped;
  readonly #steps = new Set<Step>();
  readonly #pauses = new Set<string>();
  #frame: number | undefined;
  /** When the last frame was given; undefined once stopped. */
  #given: number | undefined;
  /** Milliseconds run. */
  #clock = 0;
  /** Whether it ran when last looked at: a stop is told once. */
  #ran = false;

  constructor(on: Looped) {
    this.#on = on;
  }

  /** Whether the loop draws: something is kept and nothing pauses it. */
  get running(): boolean {
    return this.#steps.size > 0 && this.#pauses.size === 0;
  }

  /** Keeps the loop running for something that moves, `step` before each frame, until the
   * release returned is called. */
  keep(step: Step): () => void {
    // Its own function: the same step kept twice is two keepers.
    const kept: Step = (seconds) => {
      step(seconds);
    };

    this.#steps.add(kept);
    this.#sync();

    return () => {
      this.#steps.delete(kept);
      this.#sync();
    };
  }

  /** Pauses the loop for `why` while `on`; it runs once no reason is left. */
  pause(why: string, on: boolean): void {
    if (on) this.#pauses.add(why);
    else this.#pauses.delete(why);

    this.#sync();
  }

  #sync(): void {
    const { running } = this;

    if (running === this.#ran) return;

    this.#ran = running;

    if (running) {
      this.#on.started();
      this.#next();

      return;
    }

    // None pending while a step of its own frame ended it.
    if (this.#frame !== undefined) this.#on.frames.cancel(this.#frame);

    this.#frame = undefined;
    this.#given = undefined;
    this.#on.stopped();
  }

  #next(): void {
    this.#frame ??= this.#on.frames.request((now) => {
      this.#frame = undefined;
      this.#on.count(now);
      this.#clock += Math.min(now - (this.#given ?? now), LONGEST);
      this.#given = now;

      if (this.#on.due(now)) {
        for (const step of this.#steps) step(this.#clock / 1000);

        this.#on.draw(now);
      }

      // A step or the draw may have ended it.
      if (this.running) this.#next();
    });
  }
}

/** Pauses `loop` while `canvas` cannot be seen: the tab is hidden, or the canvas is off screen.
 * The disposer stops watching. */
export function pauseUnseen(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it is paused.
  loop: Loop,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own, only watched.
  canvas: HTMLCanvasElement,
): () => void {
  const hidden = (): void => {
    loop.pause("hidden", document.visibilityState === "hidden");
  };

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own entries.
  const screen = new IntersectionObserver((entries) => {
    loop.pause("off screen", entries.at(-1)?.isIntersecting === false);
  });

  document.addEventListener("visibilitychange", hidden);
  screen.observe(canvas);
  hidden();

  return () => {
    document.removeEventListener("visibilitychange", hidden);
    screen.disconnect();
  };
}
