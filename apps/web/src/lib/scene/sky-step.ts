// When the sky that lights a scene is made again (ADR 20 Rendering): only once the sun has moved
// far enough to show. Pure: the environment keys its sky by it.
import type { Point } from "../builder/pv.ts";

const DEGREES = Math.PI / 180;

/** Degrees under the horizon from where the sky is one: its light is gone, wherever the sun is. */
const NIGHT = -10;

/**
 * How far the sun moves before the sky is made again, in degrees, by its elevation. Measured on
 * a house with modules at Hoch: a sky this stale moves 99 pixels in 100 by under 2 % of their
 * range, as a sky a degree stale does near the horizon, where its colour turns quickly.
 */
function step(elevation: number): number {
  if (elevation < 15) return 1;

  return elevation < 35 ? 2.5 : 5;
}

/** The sky a sun `toward` (a unit vector east, north, up) is lit by: two suns of one step share
 * a sky. */
export function skyStep(toward: Point): string {
  const elevation = Math.asin(Math.max(-1, Math.min(1, toward[2]))) / DEGREES;

  if (elevation <= NIGHT) return "night";

  const degrees = step(elevation);
  const up = Math.round(elevation / degrees);
  // A degree round the horizon is less of the sky the higher the sun stands.
  const round = degrees / Math.max(Math.cos(up * degrees * DEGREES), 0.1);
  // Round from south, so the grid's seam lies in the north, where the sun seldom stands by day.
  const azimuth = Math.atan2(0 - toward[0], 0 - toward[1]) / DEGREES;

  return `${degrees} ${up} ${Math.round(azimuth / round)}`;
}
