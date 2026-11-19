// The frame limit (ADR 21 "Frame limit"): the most frames a second a browser lets the 3D scene
// draw, as plain TS. The rune shell that keeps the choice per browser is `./frame-limit.svelte.ts`.

/** Where each browser keeps its frame limit: "unlimited", "60" or "30"; unset reads as unlimited. */
export const FRAME_LIMIT = "sunreye.frame-limit";

/** What the setting offers: the display's own rate, or at most 60 or 30 frames a second. */
export const FRAME_LIMITS = ["unlimited", "60", "30"] as const;

export type FrameLimit = (typeof FRAME_LIMITS)[number];

/** A kept limit; anything unreadable is unlimited. */
export function parseFrameLimit(raw: string | null): FrameLimit {
  return FRAME_LIMITS.find((limit) => limit === raw) ?? "unlimited";
}

/** Milliseconds between two frames `limit` allows; 0 for every frame the display gives. */
export function frameInterval(limit: FrameLimit): number {
  return limit === "unlimited" ? 0 : 1000 / Number(limit);
}

/** A frame this much early is taken: a display's frames are never evenly apart, and 60 Hz
 * would else fall to 20 under a limit of 30. */
const EARLY = 4;

/** A frame this near its due time is the display's own beat, and the count follows it: a display
 * a hair faster than the limit would else run ahead of it and lose a frame every few seconds. */
const ON_BEAT = 0.5;

/** Holds what draws to a frame limit: asked with each frame the display gives. */
export class Pace {
  readonly #interval: () => number;
  /** When the next frame is due. */
  #due: number | undefined;

  /** `interval`: the milliseconds between two frames, read anew for each. */
  constructor(interval: () => number) {
    this.#interval = interval;
  }

  /** Whether the display's frame at `now` may be drawn in; if so, the next is due an interval
   * after this one was, so frames taken early and late even out to the limit. */
  take(now: number): boolean {
    const interval = this.#interval();
    const due = this.#due;

    if (interval > 0 && due !== undefined && now < due - EARLY) return false;

    // After a rest the count starts at this frame, not where it left off.
    const anew = due === undefined || now - due > interval || Math.abs(now - due) <= ON_BEAT;

    this.#due = (anew ? now : due) + interval;

    return true;
  }
}
