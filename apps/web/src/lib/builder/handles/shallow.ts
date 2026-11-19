// A level drag seen from a shallow view (ADR 20): from under 15° above its plane, as the north,
// east, south and west views stand, the plane is nearly edge-on and a finger's width up the screen
// would be tens of metres. There the pointer's travel up the screen moves the object as far away
// from the camera as that travel is long at the grab's distance. Pure and three.js-free.
import { level, meet, type Ray, type Triple } from "./frame.ts";

/** The sine of the lowest view a level drag still follows the pointer's ray from. */
const SHALLOW = Math.sin((15 * Math.PI) / 180);

const dot = (a: Triple, b: Triple): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross = (a: Triple, b: Triple): Triple => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Where a drag from `start` to `end` began and stands now in the level plane at `height`: where
 * the rays meet it, or from a shallow view the point `grabbed` moved by the pointer's travel
 * across the screen, sideways and away. Null where a ray misses. */
export function onLevel(
  [start, end]: readonly [Ray, Ray],
  height: number,
  grabbed?: Triple,
): readonly [Triple, Triple] | null {
  const [dx, dy, dz] = start.direction;
  const flat = Math.hypot(dx, dz);

  if (Math.abs(dy) >= SHALLOW || flat < 1e-6) {
    const [from, to] = [level(start, height), level(end, height)];

    return from === null || to === null ? null : [from, to];
  }

  const held = grabbed ?? level(start, height);
  const met = held && meet(end, held, start.direction);

  if (held === null || met === null) return null;

  const away: Triple = [dx / flat, 0, dz / flat];
  const right: Triple = [-away[2], 0, away[0]];
  const over = cross(right, start.direction);
  const travel: Triple = [met[0] - held[0], met[1] - held[1], met[2] - held[2]];
  const [aside, up] = [dot(travel, right), dot(travel, over)];

  return [
    [held[0], height, held[2]],
    [held[0] + aside * right[0] + up * away[0], height, held[2] + aside * right[2] + up * away[2]],
  ];
}
