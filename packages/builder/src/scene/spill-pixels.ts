// The light a lit opening throws on the ground, as pixels (ADR 20 Openings). Pure: no three.js
// and no DOM.
import type { Pixels } from "./pixels.ts";

/** Where the spill is brightest, as a share of its depth from the edge nearest the wall. */
const PEAK = 0.25;

const SIZE = 64;

/** A lit room's warm light. */
const WARM = [255, 196, 120] as const;

/** How bright the spill is at a pixel, 0 to 1: dark at the edge nearest the wall, brightest a
 * little way out, then fading and spreading. */
function light(x: number, y: number): number {
  // The first row is the edge nearest the wall; both ends are dark, so no edge shows.
  const away = y / (SIZE - 1);
  const tail = Math.min(1, (1 - away) / 0.4);
  const along = (away / PEAK) * Math.exp(1 - away / PEAK) * tail * tail * (3 - 2 * tail);
  const half = 0.45 + 0.55 * away;
  const side = Math.max(0, 1 - Math.abs(x - SIZE / 2 + 0.5) / (SIZE / 2) / half);

  return along * side * side * (3 - 2 * side);
}

export function spill() {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const lit = light(x, y);

      data.set([WARM[0] * lit, WARM[1] * lit, WARM[2] * lit, 255], (y * SIZE + x) * 4);
    }

  const map: Pixels = { w: SIZE, h: SIZE, data };

  return { "spill.map": map };
}
