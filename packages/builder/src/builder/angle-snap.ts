// The line being traced turned onto a direction it nearly takes (#74): square or 45° to the last
// line, square to the chain's first (a rectangle closes square), parallel or square to a traced
// line nearby, else the plan's axes and 45°. Pure; in the scene's x and z.
import type { Plan } from "./plan.ts";

/** What the line is turned by: unit directions. */
export interface Bearings {
  /** The chain's last line, from its start to the corner the line goes on from. */
  readonly previous?: Plan | undefined;
  /** The chain's first line. */
  readonly first?: Plan | undefined;
  /** Traced lines near the pointer. */
  readonly edges: readonly Plan[];
}

export interface Angled {
  /** The pointer brought onto the direction, as far along it as the pointer is. */
  readonly at: Plan;
  /** Degrees: at the corner between the last line and this one, else to the direction snapped. */
  readonly angle: number;
  /** A guide through the corner along the direction, longer than the line. */
  readonly guide: readonly [Plan, Plan];
}

/** Degrees off a direction the pointer still snaps within. */
const TOLERANCE = 4;

/** Metres the guide runs at the least, each way. */
const GUIDE = 50;

const RAD = Math.PI / 180;

/** `a − b` in radians, −π to π. */
const off = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** A direction a line may take, in radians, and the bearing it was stepped from. */
interface Stop {
  readonly to: number;
  readonly base: number;
}

const bearing = ([x, z]: Plan): number => Math.atan2(z, x);

/** Each direction a line may take, `step` degrees apart, from `direction`. */
function stops(direction: Plan | undefined, step: number): Stop[] {
  if (direction === undefined) return [];

  const base = bearing(direction);

  return Array.from({ length: 360 / step }, (_, k) => ({ to: base + k * step * RAD, base }));
}

/** The stop nearest bearing `aim`. */
function nearest(aim: number, candidates: readonly Stop[]): Stop | undefined {
  const [first, ...rest] = candidates;

  if (first === undefined) return undefined;

  return rest.reduce(
    (kept, next) => (Math.abs(off(aim, next.to)) < Math.abs(off(aim, kept.to)) ? next : kept),
    first,
  );
}

/** The direction from `from` toward `pointer` snapped by `bearings`; undefined when it is off
 * every one by more than `tolerance` degrees. */
export function angleSnap(
  from: Plan,
  pointer: Plan,
  { previous, first, edges }: Bearings,
  tolerance = TOLERANCE,
): Angled | undefined {
  const [dx, dz] = [pointer[0] - from[0], pointer[1] - from[1]];
  const length = Math.hypot(dx, dz);

  if (length === 0) return undefined;

  const aim = Math.atan2(dz, dx);
  const fallback = previous === undefined && first === undefined && edges.length === 0;

  const candidates = [
    ...stops(previous, 45),
    ...stops(first, 90),
    ...edges.flatMap((edge) => stops(edge, 90)),
    ...(fallback ? stops([1, 0], 45) : []),
  ];

  const best = nearest(aim, candidates);

  if (best === undefined || Math.abs(off(aim, best.to)) > tolerance * RAD) return undefined;

  const along = length * Math.cos(off(aim, best.to));
  const [ux, uz] = [Math.cos(best.to), Math.sin(best.to)];
  const reach = Math.max(GUIDE, 2 * length);
  const turn = Math.abs(off(best.to, best.base)) / RAD;

  // At the corner the last line comes back the other way: a straight run on is 180°. Without
  // one, the angle to the line snapped to, 0° parallel to 90° square.
  const angle =
    previous === undefined
      ? Math.min(turn, 180 - turn)
      : 180 - Math.abs(off(best.to, bearing(previous))) / RAD;

  return {
    at: [from[0] + ux * along, from[1] + uz * along],
    angle,
    guide: [
      [from[0] - ux * reach, from[1] - uz * reach],
      [from[0] + ux * reach, from[1] + uz * reach],
    ],
  };
}
