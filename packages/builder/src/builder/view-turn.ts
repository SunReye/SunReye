// The plan turned about the up axis (#74): to any heading, a face's eave level across the screen,
// and gentle detents a turning hand settles into. Pure.
import { headingOf, type View } from "./view.ts";
import type { RoofFace } from "./pv.ts";

const RAD = Math.PI / 180;

/** Degrees off a stop a heading still settles into. */
const DETENT = 3;

/** Degrees `heading` takes, 0 to 360. */
const around = (heading: number): number => ((heading % 360) + 360) % 360;

/** `view` turned about its target's up axis until it looks `heading` degrees clockwise from north
 * up the screen; as far from its target. */
export function withHeading(view: View, heading: number): View {
  const by = (heading - headingOf(view)) * RAD;
  const [x, y, z] = view.position.map((p, i) => p - (view.target[i] ?? 0));
  const [tx, ty, tz] = view.target;

  const [dx, dz] = [
    (x ?? 0) * Math.cos(by) - (z ?? 0) * Math.sin(by),
    (x ?? 0) * Math.sin(by) + (z ?? 0) * Math.cos(by),
  ];

  return { position: [tx + dx, ty + (y ?? 0), tz + dz], target: view.target };
}

/** The heading at which `face`'s eave lies level across the screen, the face above it: up its
 * slope; a flat face along its outline's width. */
export function eaveHeading({ across, up }: RoofFace): number {
  const [e, n] = up;

  if (Math.hypot(e, n) > 1e-6) return around(Math.atan2(e, n) / RAD);

  return around(Math.atan2(across[0], across[1]) / RAD - 90);
}

/** `heading` settled into the nearest of `stops` within `within` degrees, else as it is. */
export function detent(heading: number, stops: readonly number[], within = DETENT): number {
  const off = (stop: number): number => Math.abs(around(heading - stop + 180) - 180);
  const near = stops.filter((stop) => off(stop) <= within).toSorted((a, b) => off(a) - off(b));

  return near[0] === undefined ? heading : around(near[0]);
}
