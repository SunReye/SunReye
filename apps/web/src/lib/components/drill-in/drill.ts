import { reducedMotion } from "../../animate.ts";
import { LOW_POWER } from "../../live/dashboard.ts";

/** Ease-in-out time for the slide from progress `from` to `to`: 300 ms for the full way (ADR 21). */
export function slideMs(from: number, to: number): number {
  return 60 + 240 * Math.abs(to - from);
}

/** Where an edge-swipe released at progress `p` with `velocity` (widths/s) settles: 0 closed, 1 open. */
export function settle(p: number, velocity: number): 0 | 1 {
  return velocity < -1.2 || (p < 0.5 && velocity < 0.6) ? 0 : 1;
}

/** Reduced motion and the low-power switch make every slide instant (ADR 21). */
export function still(): boolean {
  return reducedMotion() || globalThis.localStorage?.getItem(LOW_POWER) === "on";
}
