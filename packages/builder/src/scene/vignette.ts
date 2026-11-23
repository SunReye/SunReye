// The studio backdrop's vignette (ADR 20 Look), without three.js: the scene's backdrop and the
// stand-in the hero shows while the scene loads are made from it, so the fade changes nothing
// but the house.

export type Linear = readonly [number, number, number];

/** The vignette's light middle, how far toward it, and its darker edge, by theme. */
const VIGNETTE = {
  light: { light: [1, 1, 1], toward: 0.55, edge: 0.93 },
  dark: { light: [0.06, 0.065, 0.075], toward: 0.4, edge: 0.7 },
} as const;

/** From the light middle, 0, to the edge, 1, at a point of the backdrop in 0..1. */
function vignette(x: number, y: number): number {
  const d = Math.min(1, Math.hypot(x - 0.5, (y - 0.42) * 1.15) * 1.6);

  return d * d * (3 - 2 * d);
}

const mix = (a: Linear, b: Linear, t: number): Linear => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** The backdrop's colour at a point in 0..1 around `page`, all linear RGB, as tone mapped. */
export function backdropAt(page: Linear, dark: boolean, x: number, y: number): Linear {
  const { light, toward, edge } = dark ? VIGNETTE.dark : VIGNETTE.light;
  const centre = mix(page, light, toward);
  const rim: Linear = [page[0] * edge, page[1] * edge, page[2] * edge];
  const t = vignette(x, y);

  return t < 0.5 ? mix(centre, page, t * 2) : mix(page, rim, (t - 0.5) * 2);
}
