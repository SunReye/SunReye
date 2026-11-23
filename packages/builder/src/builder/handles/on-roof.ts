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
  const shift = roof === undefined ? null : travelled(roof, grab, now);

  if (shift === null) return null;

  if (target.kind === "chimney") {
    const moved = pv.glide(scene, target.index, shift);

    return (
      moved && {
        scene: { ...scene, chimneys: chimneys.with(target.index, moved) },
        value: [moved.across, moved.up],
        unit: "m",
      }
    );
  }

  const moved = pv.glideWindow(scene, target.index, shift);

  return (
    moved && {
      scene: { ...scene, roofWindows: windows.with(target.index, moved) },
      value: [moved.across, moved.up],
      unit: "m",
    }
  );
}
