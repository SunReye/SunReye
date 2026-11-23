// Shared by the light's tests: a sun due south and the light a face gets.
import type { Daylight, Rgb } from "@sunreye/builder/scene/light.ts";
import { skylight } from "@sunreye/builder/scene/skylight.ts";

/** Toward the sun at `elevation` degrees, due south. */
export function south(elevation: number): [number, number, number] {
  const radians = (elevation * Math.PI) / 180;

  return [0, -Math.cos(radians), Math.sin(radians)];
}

export const luma = ({ r, g, b }: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** The sky's light on a face turned up: the shadowless fill and the sky model's environment. */
export function ambientOf(day: Daylight): number {
  return day.fill.intensity * luma(day.fill.sky) + skyOf(day);
}

/** The sky model's light on a face turned up. */
export function skyOf(day: Daylight): number {
  return day.environment * skylight(day.elevation, day.clouds.coverage);
}

/** Direct plus ambient light: what a face turned to the sun or the moon gets. */
export function lightOf(day: Daylight): number {
  return day.intensity * luma(day.colour) + ambientOf(day);
}
