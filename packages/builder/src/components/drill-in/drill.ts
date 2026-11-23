import type { Component } from "svelte";
import { SPRINGS } from "../../motion/values.ts";

/** A group of the drill-in's root list. */
export interface DrillGroup {
  readonly id: string;
  readonly label: string;
  /** Its current values in a few words, under the label. */
  readonly summary?: string;
  readonly icon?: Component<{ class?: string }>;
  /** Listed but not open, such as a setup step not yet reached. */
  readonly disabled?: boolean;
}

/** Ease-in-out time for the slide from progress `from` to `to`: 300 ms for the full way (ADR 21). */
export function slideMs(from: number, to: number): number {
  return 60 + 240 * Math.abs(to - from);
}

/** Where an edge-swipe released at progress `p` with `velocity` (widths/s) settles: 0 closed, 1 open. */
export function settle(p: number, velocity: number): 0 | 1 {
  return velocity < -1.2 || (p < 0.5 && velocity < 0.6) ? 0 : 1;
}

/** The spring that takes a released edge-swipe on at its `velocity`. */
export const released = (velocity: number) => ({ ...SPRINGS.drillIn, velocity });
