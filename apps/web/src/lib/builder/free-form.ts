// A free-form block seen from above (ADR 20): its footprint, and its faces, which may reach past
// its walls. In the scene's frame before the compass turns it. Pure.
import { contains, distance, sides, type Plan } from "./plan.ts";
import type { FreeForm } from "./roofing.ts";

/** Whether scene point `x`, `z` lies on the block seen from above, or within `margin` metres of
 * its walls' or faces' edges. */
export function overFreeForm(point: Plan, { footprint, faces }: FreeForm, margin: number): boolean {
  const outlines: (readonly Plan[])[] = [
    footprint.map(([x = 0, z = 0]): Plan => [x, z]),
    ...faces.map((face) => face.map(([x = 0, , z = 0]): Plan => [x, z])),
  ];

  return outlines.some(
    (outline) =>
      contains(outline, point) || sides(outline).some(([a, b]) => distance(point, a, b) <= margin),
  );
}
