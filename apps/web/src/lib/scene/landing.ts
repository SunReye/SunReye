// The surface a window's light lands on (ADR 20 Openings): the floor, or a lower roof under the
// window. Pure; east, north, up in metres.
import type { Face, Point } from "../builder/pv.ts";

/** A point in plan: east, north. */
export type Plan = readonly [number, number];

/** A roof seen from above: its outline, and its height over a point in plan. */
export interface Landing {
  readonly outline: readonly Plan[];
  readonly height: (at: Plan) => number;
}

/** The floor: level, without an edge. */
const FLOOR: Landing = { outline: [], height: () => 0 };

/** Which side of the edge from `a` to `b` a point lies on: positive to its left. */
const side = (a: Plan, b: Plan, [e, n]: Plan): number =>
  (b[0] - a[0]) * (n - a[1]) - (b[1] - a[1]) * (e - a[0]);

/** A convex outline's edges, each with the side its inside lies on. */
function edges(outline: readonly Plan[]): (readonly [Plan, Plan, number])[] {
  const turn = outline.reduce(
    (sum, a, i) => sum + side(a, outline[(i + 1) % outline.length] ?? a, outline.at(i - 1) ?? a),
    0,
  );

  return outline.map((a, i) => [a, outline[(i + 1) % outline.length] ?? a, Math.sign(turn)]);
}

/** A roof face as a landing; none for one standing upright. */
function landingOf({ corners }: Face): Landing | undefined {
  const [a, b, c] = corners;

  if (a === undefined || b === undefined || c === undefined) return undefined;

  const [u, v] = [
    [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
  ] as const;

  const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const [east = 0, north = 0, up = 0] = normal;

  if (Math.abs(up) < 1e-9) return undefined;

  return {
    outline: corners.map(([e, n]): Plan => [e, n]),
    height: ([e, n]) => a[2] - (east * (e - a[0]) + north * (n - a[1])) / up,
  };
}

const within = (outline: readonly Plan[], at: Plan): boolean =>
  edges(outline).every(([a, b, inside]) => side(a, b, at) * inside >= 0);

/** The highest of `roofs` under `at` and no higher than it; the floor where there is none. */
export function landingUnder(roofs: readonly Face[], at: Point): Landing {
  const plan: Plan = [at[0], at[1]];

  return roofs
    .flatMap((roof) => landingOf(roof) ?? [])
    .filter((roof) => within(roof.outline, plan) && roof.height(plan) <= at[2])
    .reduce((best, roof) => (roof.height(plan) > best.height(plan) ? roof : best), FLOOR);
}

/** Where the edge from `a` to `b` crosses the line `from`–`to`. */
function crossing(a: Plan, b: Plan, from: Plan, to: Plan): Plan {
  const [da, db] = [side(from, to, a), side(from, to, b)];
  const part = da / (da - db);

  return [a[0] + (b[0] - a[0]) * part, a[1] + (b[1] - a[1]) * part];
}

/** The part of the convex `patch` on the inner side of one edge. */
function cut(patch: readonly Plan[], [from, to, inside]: readonly [Plan, Plan, number]): Plan[] {
  const inner = (at: Plan): boolean => side(from, to, at) * inside >= 0;

  return patch.flatMap((at, i) => {
    const before = patch.at(i - 1) ?? at;
    const crossed = inner(at) === inner(before) ? [] : [crossing(before, at, from, to)];

    return inner(at) ? [...crossed, at] : crossed;
  });
}

/** The part of the convex `patch` over `landing`: all of it on the floor. */
export function clipped(landing: Landing, patch: readonly Plan[]): readonly Plan[] {
  return edges(landing.outline).reduce<readonly Plan[]>((kept, edge) => cut(kept, edge), patch);
}
