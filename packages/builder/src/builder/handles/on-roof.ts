// A chimney's or a roof window's drag (ADR 20): in its roof face's plane, so it stays under the
// pointer from every view. Pure; rays are in three.js's frame, as the crate's roofs lie in it.
import { roofFaceKey } from "@sunreye/scene";
import type { Point, RoofFace, Scene } from "../pv.ts";
import { cross } from "../vector.ts";
import type { Target } from "./body.ts";
import type { Crate, Dragged, Grab } from "./dragging.ts";
import { level, meet, type Ray, type Triple } from "./frame.ts";

/** East, north, up as three.js has it: x east, y up, z south. */
const three = ([east, north, up]: Point): Triple => [east, up, 0 - north];

/** How far the pointer went from `grab` to `now` in the plane through the grabbed point that lies
 * along `roof`, as the level east and north the crate glides by; null where the ray misses it. */
function travelled(
  roof: RoofFace,
  { ray, height }: Grab,
  now: Ray,
): readonly [number, number] | null {
  const normal = cross(three(roof.across), three(roof.up));
  // Where the press struck: on a chimney's top the roof's own plane would lie well behind it.
  const anchor = level(ray, height) ?? three(roof.origin);
  const to = meet(now, anchor, normal);

  return to === null ? null : [to[0] - anchor[0], anchor[2] - to[2]];
}

type Corner = RoofFace["outline"][number];

/** Where the edge from `p` to `q` crosses the line at `at` along `axis`, on the other axis; null
 * where it does not. */
function crossing(p: Corner, q: Corner, axis: 0 | 1, at: number): number | null {
  const other = axis === 0 ? 1 : 0;
  const [a, b, c, d] = [p[axis], q[axis], p[other], q[other]];

  if (a === b || at < Math.min(a, b) || at > Math.max(a, b)) return null;

  return c + ((d - c) * (at - a)) / (b - a);
}

/** Where the line across `outline` at `at` along axis `axis` (0 across, 1 up) enters and leaves
 * it; the outline's extent where the line misses it. */
function span(outline: RoofFace["outline"], axis: 0 | 1, at: number): readonly [number, number] {
  const hits = outline.flatMap((p, index) => {
    const hit = crossing(p, outline[(index + 1) % outline.length] ?? p, axis, at);

    return hit === null ? [] : [hit];
  });

  const all = hits.length > 0 ? hits : outline.map((p) => p[axis === 0 ? 1 : 0]);

  return [Math.min(...all), Math.max(...all)];
}

const tidy = (metres: number) => Math.round(metres * 1000) / 1000;

/** Metres from the eave below a roof object to its lower edge, and from its nearer verge to its
 * side: what an installer checks clearances by. */
function clearance(
  outline: RoofFace["outline"],
  {
    across,
    up,
    width,
    deep,
  }: {
    readonly across: number;
    readonly up: number;
    readonly width: number;
    readonly deep: number;
  },
): number[] {
  const [eave] = span(outline, 0, across);
  const [left, right] = span(outline, 1, up);

  return [
    tidy(up - deep / 2 - eave),
    tidy(Math.min(across - width / 2 - left, right - across - width / 2)),
  ];
}

/** A chimney or a roof window follows the pointer in its roof face's plane, so it stays under it
 * from every view (ADR 20), where the crate lets it. */
export function onRoof(
  scene: Scene,
  target: Target,
  [grab, now]: readonly [Grab, Ray],
  { pv, laid }: Crate,
): Dragged | null {
  const [chimneys, windows] = [scene.chimneys ?? [], scene.roofWindows ?? []];
  const item = (target.kind === "chimney" ? chimneys : windows)[target.index];
  const roof = item && laid.roofs.find((r) => roofFaceKey(r) === roofFaceKey(item));

  if (roof === undefined) return null;

  const shift = travelled(roof, grab, now);

  if (shift === null) return null;

  if (target.kind === "chimney") {
    const moved = pv.glide(scene, target.index, shift);

    return (
      moved && {
        scene: { ...scene, chimneys: chimneys.with(target.index, moved) },
        value: clearance(roof.outline, { ...moved, deep: moved.depth }),
        unit: "roof",
      }
    );
  }

  const moved = pv.glideWindow(scene, target.index, shift);

  return (
    moved && {
      scene: { ...scene, roofWindows: windows.with(target.index, moved) },
      value: clearance(roof.outline, { ...moved, deep: moved.length }),
      unit: "roof",
    }
  );
}
