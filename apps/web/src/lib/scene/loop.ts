// The weather loop (ADR 23 "Motion"): the one loop the scene draws in, and only while something
// that moves is kept on show. At most 30 frames a second, none while paused, and every frame the
// display gives is counted for the frame watch (ADR 21). The frames are handed in.

/** The display's frames, as `requestAnimationFrame` gives them. */
export interface Frames {
  readonly request: (frame: (now: number) => void) => number;
  readonly cancel: (id: number) => void;
}

export interface Looped {
  readonly frames: Frames;
  /** Draws the scene at the frame's `now`; true to draw the next frame too, whatever the cap. */
  readonly draw: (now: number) => boolean;
  /** Told of every frame the display gives while the loop runs, drawn in or not. */
  readonly count: (now: number) => void;
  /** The loop has stopped or paused: the picture it leaves is settled by whoever draws on. */
  readonly stopped: () => void;
}

/** What moves in the loop: told the seconds the loop has run, before each frame it draws. */
export type Step = (seconds: number) => void;

/** Milliseconds between two drawn frames: 30 a second. */
const INTERVAL = 1000 / 30;

/** A frame this much early is drawn in: a display's frames are never evenly apart, and 60 Hz
 * would else fall to 20. */
const EARLY = 4;

/** The most the loop's clock moves in one frame: a stall is not a leap. */
const LONGEST = 100;

export class Loop {
  readonly #on: Looped;
  readonly #steps = new Set<Step>();
  readonly #pauses = new Set<string>();
  #frame: number | undefined;
  /** When the last frame was drawn and when the last was given; undefined once stopped. */
  #drawn: number | undefined;
  #given: number | undefined;
  /** Milliseconds run. */
  #clock = 0;
  #due = false;
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

  /** Draws in the next frame, whatever the cap: the picture changed besides. */
  ask(): void {
    this.#due = true;
  }

  #sync(): void {
    const { running } = this;

    if (running === this.#ran) return;

    this.#ran = running;

    if (running) {
      this.#next();

      return;
    }

    // None pending while a step of its own frame ended it.
    if (this.#frame !== undefined) this.#on.frames.cancel(this.#frame);

    this.#frame = undefined;
    this.#drawn = undefined;
    this.#given = undefined;
    this.#due = false;
    this.#on.stopped();
  }

  #next(): void {
    this.#frame ??= this.#on.frames.request((now) => {
      this.#frame = undefined;
      this.#on.count(now);
      this.#clock += Math.min(now - (this.#given ?? now), LONGEST);
      this.#given = now;

      if (this.#due || this.#drawn === undefined || now - this.#drawn >= INTERVAL - EARLY) {
        this.#drawn = now;

        for (const step of this.#steps) step(this.#clock / 1000);

        this.#due = this.#on.draw(now);
      }

      // A step or the draw may have ended it.
      if (this.running) this.#next();
    });
  }
}

/** Pauses `loop` while `canvas` cannot be seen: the tab is hidden, or the canvas is off screen.
 * The disposer stops watching. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's own, only watched.
export function pauseUnseen(loop: Loop, canvas: HTMLCanvasElement): () => void {
  const hidden = (): void => {
    loop.pause("hidden", document.visibilityState === "hidden");
  };

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
