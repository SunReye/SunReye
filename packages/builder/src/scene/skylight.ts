// The sky model's own light (ADR 20 Look), as the light needs it to make up for a dim sky. Pure.
import { mix } from "./colour.ts";

/** The sky model's clouds, clear and closed: how much of the sky they cover and how solid they
 * are, 0 to 1. */
export const CLEAR = { coverage: 0.32, density: 0.35 };
export const CLOSED = { coverage: 0.9, density: 0.85 };

/**
 * The sky model's light on a face turned up, by the sun's elevation in degrees, under its clear
 * and its closed clouds: measured from the model in the light theme (the dark one's is no
 * dimmer), with the haze this module gives it.
 */
const SKYLIGHT: readonly (readonly [number, number, number])[] = [
  [-2, 0, 0],
  [0, 0.1, 0.08],
  [1, 0.2, 0.17],
  [2, 0.32, 0.3],
  [3, 0.48, 0.47],
  [5, 0.87, 0.94],
  [8, 1.57, 1.93],
  [10, 2.05, 2.72],
  [12, 2.51, 3.55],
  [15, 3.08, 4.7],
  [18, 3.45, 5.52],
  [21, 3.64, 6.07],
  [25, 3.66, 6.64],
  [30, 3.52, 7.21],
  [36, 3.37, 7.94],
  [42, 3.55, 8.89],
  [50, 4.2, 10.42],
  [60, 5.03, 12.3],
  [75, 6.2, 14.81],
  [90, 7.25, 16.88],
];

/**
 * The sky model's light on a face turned up, before the environment's strength: for a sun at
 * `elevation` degrees under clouds that cover `coverage` of the sky.
 */
export function skylight(elevation: number, coverage: number): number {
  const closed = Math.min(
    1,
    Math.max(0, (coverage - CLEAR.coverage) / (CLOSED.coverage - CLEAR.coverage)),
  );

  const above = SKYLIGHT.findIndex(([at]) => at >= Math.min(90, elevation));
  const [to, from] = [SKYLIGHT[above], SKYLIGHT[above - 1]];

  // Under the table's first elevation the model is black.
  if (to === undefined || from === undefined) return 0;

  const k = (elevation - from[0]) / (to[0] - from[0]);

  return mix(mix(from[1], to[1], k), mix(from[2], to[2], k), closed);
}
