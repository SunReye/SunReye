// What a press or click in the drawn scene strikes (ADR 20): a module, a marker or a surface.
import { type Camera, type Group, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Point } from "./pv.ts";
import type { Panel } from "./scene.ts";

/** The lawn, which the studio draws outside `buildScene`'s meshes. */
const LAWN = new Plane(new Vector3(0, 1, 0), 0);

/** Metres a module may sit behind the roof it lies on, by depth-buffer rounding. */
const ON_ROOF = 0.05;

/** What a click in the scene struck: a module of a grid, a marker, or a surface at a point. */
export type Hit =
  | {
      readonly kind: "grid";
      readonly grid: number;
      /** The module's cell, when the panel names it. */
      readonly cell?: { readonly row: number; readonly column: number };
    }
  | { readonly kind: "equipment"; readonly index: number }
  | { readonly kind: "point"; readonly point: Point };

/**
 * What the ray from `camera` through `at` (−1 to 1 across the canvas, y up) strikes first among
 * `buildScene`'s meshes, else the lawn (a car place stands on it); null for nothing.
 */
export function strike(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js updates its matrices.
  group: Group,
  panels: readonly Panel[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js updates its matrices.
  camera: Camera,
  at: readonly [number, number],
): Hit | null {
  const ray = new Raycaster();

  ray.setFromCamera(new Vector2(...at), camera);

  const hits = ray.intersectObject(group, true);
  const [nearest] = hits;

  if (nearest === undefined) {
    const lawn = ray.ray.intersectPlane(LAWN, new Vector3());

    return lawn === null ? null : { kind: "point", point: [lawn.x, 0 - lawn.z, 0] };
  }

  // A module lies on its roof: a tie in depth goes to the module.
  const first =
    hits.find(
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's hit, read only.
      ({ object, distance }) => object.name === "module" && distance <= nearest.distance + ON_ROOF,
    ) ?? nearest;

  const { object, point } = first;
  const index = group.getObjectsByProperty("name", object.name).indexOf(object);
  const { grid, row, column } = panels[index] ?? {};

  if (object.name === "module" && grid !== undefined) {
    return row === undefined || column === undefined
      ? { kind: "grid", grid }
      : { kind: "grid", grid, cell: { row, column } };
  }

  if (object.name === "equipment") return { kind: "equipment", index };

  return { kind: "point", point: [point.x, 0 - point.z, point.y] };
}
