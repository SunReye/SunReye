// The live graph's value range (ADR 21): stable and round, so a 1 % wobble does not rescale the
// plot on every sample.
import type { LivePoint } from "./series.ts";

/** The tick step for a series reaching `reach` kW either side of zero. */
function stepFor(reach: number): number {
  if (reach > 4) return 2;

  return reach > 1.5 ? 1 : 0.5;
}

/** `v` with 12 % headroom, rounded up onto `step`. */
const up = (v: number, step: number) => Math.ceil((v * 1.12) / step) * step;

/** The y range for `data` in kW; a diverging one always shows both sides of zero. */
export function valueDomain(data: readonly LivePoint[], diverging: boolean): [number, number] {
  const values = data.map((p) => p.v);
  const top = Math.max(0, ...values);
  const bottom = Math.min(0, ...values);
  const step = stepFor(Math.max(top, -bottom));
  const half = diverging ? step / 2 : 0;
  const hi = top > 0 ? up(top, step) : half;
  const lo = bottom < 0 ? -up(-bottom, step) : 0 - half;

  return hi === lo ? [lo, lo + step] : [lo, hi];
}
