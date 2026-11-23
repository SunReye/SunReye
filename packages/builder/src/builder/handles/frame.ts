// The handles' geometry (ADR 20): the scene's frame against three.js's, planes, and snapping.
// Pure and three.js-free.

/** A point or a direction: x, up, z. */
export type Triple = readonly [number, number, number];

export interface Ray {
  readonly origin: Triple;
  readonly direction: Triple;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/** Float noise off a result: never further than a micrometre, never −0. */
export const tidy = (value: number): number => Math.round(value * 1e6) / 1e6 + 0;

export const snap = (value: number, step: number): number => tidy(Math.round(value / step) * step);

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** The pv crate's `turn`: clockwise seen from above, where forward is −z. */
export function turn(x: number, z: number, by: number): [number, number] {
  const [sin, cos] = [Math.sin(toRadians(by)), Math.cos(toRadians(by))];

  return [x * cos - z * sin, x * sin + z * cos];
}

/** A scene-frame point in three.js's frame, whose x and z the scene's north turns. */
export function world(north: number, [x, y, z]: Triple): Triple {
  const [east, south] = turn(x, z, north);

  return [east, y, south];
}

/** A three.js ray in the scene's frame. */
export function inScene(north: number, { origin, direction }: Ray): Ray {
  return { origin: world(-north, origin), direction: world(-north, direction) };
}

const dot = (a: Triple, b: Triple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Where `ray` meets the plane through `at` facing `normal`; null behind it or alongside. */
export function meet({ origin, direction }: Ray, at: Triple, normal: Triple): Triple | null {
  const facing = dot(direction, normal);

  if (Math.abs(facing) < 1e-9) return null;

  const t = dot([at[0] - origin[0], at[1] - origin[1], at[2] - origin[2]], normal) / facing;

  if (t < 0) return null;

  return [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t];
}

/** Where `ray` meets the level plane at `height`. */
export const level = (ray: Ray, height: number): Triple | null =>
  meet(ray, [0, height, 0], [0, 1, 0]);
