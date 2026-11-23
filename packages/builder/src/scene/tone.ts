// The studio's tone mapping, undone (ADR 20 Look, Rendering quality): what to draw so that it
// lands on a wanted colour. Pure.

/** Where the tone mapping (Khronos PBR Neutral, as three.js applies it) starts to compress, and
 * how far a compressed colour is drawn toward white. */
const SHOULDER = 0.76;
const DESATURATION = 0.15;

/** The brightest a target may be: white itself lies infinitely far up the shoulder. */
const BRIGHTEST = 0.9995;

/** A colour before the shoulder compressed it to `toned`, whose peak is `peak`. */
function unshouldered(toned: Triple, peak: number): Triple {
  if (peak < SHOULDER) return toned;

  const d = 1 - SHOULDER;
  const before = (d * d) / (1 - peak) - d + SHOULDER;
  const grey = 1 - 1 / (DESATURATION * (before - peak) + 1);
  const scale = before / peak / (1 - grey);

  return [
    (toned[0] - peak * grey) * scale,
    (toned[1] - peak * grey) * scale,
    (toned[2] - peak * grey) * scale,
  ];
}

/** What the tone mapping took off every channel of a colour whose least channel is now `least`. */
function toe(least: number): number {
  return least >= 0.04 ? 0.04 : Math.sqrt(Math.max(least, 0) / 6.25) - Math.max(least, 0);
}

/** Linear red, green and blue. */
export type Triple = readonly [number, number, number];

/** The linear colour that lands on `target` after `exposure` and the tone mapping: the backdrop
 * and the fog then meet the page colour exactly. */
export function untone(target: Triple, exposure: number): [number, number, number] {
  const [r, g, b] = target.map((v) => Math.min(Math.max(v, 0), BRIGHTEST));
  const toned: Triple = [r ?? 0, g ?? 0, b ?? 0];
  const before = unshouldered(toned, Math.max(...toned));
  const lift = toe(Math.min(...before));

  return [
    (before[0] + lift) / exposure,
    (before[1] + lift) / exposure,
    (before[2] + lift) / exposure,
  ];
}
