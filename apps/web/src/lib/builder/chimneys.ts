// Where a roof chimney stands in the scene (ADR 20): its foot on its face, what a strike on it
// lands on, and a drag along its face that keeps it wholly on the face. Pure.
import type { Chimney, Point, RoofFace, Scene } from "./pv.ts";

/** A strike this close to a chimney's sides or top, in metres, still lands on it. */
const EDGE = 0.05;

/** Its 10 cm steps along the face. */
const STEP = 0.1;

type Flat = readonly [number, number];

const roofOf = (roofs: readonly RoofFace[], { block, face }: Chimney): RoofFace | undefined =>
  roofs.find((roof) => roof.block === block && roof.face === face);

/** Its footprint on `roof` as the crate's `Chimney::area`: lower left and upper right corner. */
function area({ across, up, width, depth }: Chimney, { tilt }: RoofFace): readonly [Flat, Flat] {
  const [halfAcross, halfUp] = [width / 2, depth / 2 / Math.cos((tilt * Math.PI) / 180)];

  return [
    [across - halfAcross, up - halfUp],
    [across + halfAcross, up + halfUp],
  ];
}

const corners = ([[l, b], [r, t]]: readonly [Flat, Flat]): Flat[] => [
  [l, b],
  [r, b],
  [r, t],
  [l, t],
];

/** The scene point at `u` across and `v` up `roof`. */
function onRoof(
  { origin: [oe, on, ou], across: [ae, an, au], up: [ue, un, uu] }: RoofFace,
  [u, v]: Flat,
): Point {
  return [oe + ae * u + ue * v, on + an * u + un * v, ou + au * u + uu * v];
}

/** Its foot's corners on the roof, east, north, up, and the height of its level top. */
export interface Footing {
  readonly foot: readonly Point[];
  readonly top: number;
}

export function footing(chimney: Chimney, roof: RoofFace): Footing {
  const foot = corners(area(chimney, roof)).map((p) => onRoof(roof, p));

  return { foot, top: Math.max(...foot.map(([, , up]) => up)) + chimney.height };
}

/** A level move of `east` and `north` metres as across and up `roof`, seen from above. */
function onFace({ across, up }: RoofFace, [east, north]: Flat): Flat {
  const level = Math.hypot(up[0], up[1]);

  return [
    east * across[0] + north * across[1],
    (east * up[0] + north * up[1]) / (level * level || 1),
  ];
}

/** The index of the chimney a strike at scene point `point` lands on; −1 for none. */
export function chimneyAt(scene: Scene, roofs: readonly RoofFace[], point: Point): number {
  return (scene.chimneys ?? []).findIndex((chimney) => {
    const roof = roofOf(roofs, chimney);

    if (roof === undefined) return false;

    const { foot, top } = footing(chimney, roof);
    const [[l, b], [r, t]] = area(chimney, roof);
    const [u, v] = onFace(roof, [point[0] - roof.origin[0], point[1] - roof.origin[1]]);
    const low = Math.min(...foot.map(([, , up]) => up));
    // Up the face, metres along the slope per metre seen from above.
    const slope = 1 / Math.cos((roof.tilt * Math.PI) / 180);

    return (
      u >= l - EDGE &&
      u <= r + EDGE &&
      v >= b - EDGE * slope &&
      v <= t + EDGE * slope &&
      point[2] >= low - EDGE &&
      point[2] <= top + EDGE
    );
  });
}

/** Whether `p` lies inside the face's convex, counter-clockwise outline, as the crate's
 * `RoofFace::inside` with no margin. */
function inside({ outline }: RoofFace, [u, v]: Flat): boolean {
  return outline.every(([au, av], i) => {
    const [bu, bv] = outline[(i + 1) % outline.length] ?? [au, av];
    const [du, dv] = [bu - au, bv - av];
    const length = Math.hypot(du, dv);

    return length < 1e-9 || (du * (v - av) - dv * (u - au)) / length >= -1e-9;
  });
}

const fits = (chimney: Chimney, roof: RoofFace): boolean =>
  corners(area(chimney, roof)).every((p) => inside(roof, p));

const at = (chimney: Chimney, [across, up]: Flat): Chimney => ({ ...chimney, across, up });

/** The furthest from `from`, which fits, toward `to` that still fits. */
function furthest(chimney: Chimney, roof: RoofFace, from: Flat, to: Flat): Flat {
  if (fits(at(chimney, to), roof)) return to;

  let [low, high] = [0, 1];

  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const p: Flat = [from[0] + (to[0] - from[0]) * mid, from[1] + (to[1] - from[1]) * mid];

    if (fits(at(chimney, p), roof)) low = mid;
    else high = mid;
  }

  return [from[0] + (to[0] - from[0]) * low, from[1] + (to[1] - from[1]) * low];
}

const snap = (value: number): number => Math.round(Math.round(value / STEP) * STEP * 1e6) / 1e6 + 0;

/** The chimney moved by a level `east` and `north` metres, seen from above, along its face: in
 * 10 cm steps, stopped at the face's edge and sliding along it; null without its face. */
export function glide(
  chimney: Chimney,
  roofs: readonly RoofFace[],
  shift: readonly [number, number],
): Chimney | null {
  const roof = roofOf(roofs, chimney);

  if (roof === undefined) return null;

  const [du, dv] = onFace(roof, shift);
  const wanted: Flat = [snap(chimney.across + du), snap(chimney.up + dv)];
  const start: Flat = [chimney.across, chimney.up];

  // One already off its face goes where it is dragged; the crate refuses it until it stands.
  if (!fits(chimney, roof)) return at(chimney, wanted);

  const straight = furthest(chimney, roof, start, wanted);
  const across = furthest(chimney, roof, straight, [wanted[0], straight[1]]);

  return at(chimney, furthest(chimney, roof, across, [across[0], wanted[1]]));
}
