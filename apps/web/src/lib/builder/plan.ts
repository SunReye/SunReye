// Points and polygons seen from above, in the scene's x and z. Pure.

export type Plan = readonly [number, number];

/** Each edge of a polygon, corner to corner, the last back to the first. */
export const sides = (polygon: readonly Plan[]): (readonly [Plan, Plan])[] =>
  polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length] ?? a]);

/** Whether `p` lies within the polygon, by the edges a ray from it along x crosses. */
export function contains(polygon: readonly Plan[], [x, z]: Plan): boolean {
  const crossed = sides(polygon).filter(
    ([[ax, az], [bx, bz]]) => az > z !== bz > z && x < ax + ((z - az) / (bz - az)) * (bx - ax),
  );

  return crossed.length % 2 === 1;
}

/** How far `p` lies from the segment from `a` to `b`. */
export function distance([px, pz]: Plan, [ax, az]: Plan, [bx, bz]: Plan): number {
  const [dx, dz] = [bx - ax, bz - az];
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));

  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
