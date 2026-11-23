// What a press or click in the drawn scene strikes (ADR 20): a module, a marker or a surface.
import { type Camera, type Group, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Point } from "./pv.ts";
import type { Panel } from "./scene.ts";

/** The floor, which the studio draws outside `buildScene`'s meshes. */
const FLOOR = new Plane(new Vector3(0, 1, 0), 0);

/** Metres a module may sit behind the roof it lies on, by depth-buffer rounding. */
const ON_ROOF = 0.05;

/** What a click in the scene struck: a module of a grid, a marker, an opening, or a surface at a
 * point. A point is in the shading frame: east, north, up. */
export type Hit =
  | {
      readonly kind: "grid";
      readonly grid: number;
      /** The module's position in its grid, when the panel names it. */
      readonly module?: number;
      /** Where the module was struck. */
      readonly point: Point;
    }
  | { readonly kind: "equipment"; readonly index: number }
  | { readonly kind: "opening"; readonly index: number }
  | { readonly kind: "point"; readonly point: Point };

/** Where `ray` meets the floor; null for a ray that never comes down to it. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's ray, read only.
function onFloor(ray: Raycaster): Hit | null {
  const floor = ray.ray.intersectPlane(FLOOR, new Vector3());

  return floor === null ? null : { kind: "point", point: [floor.x, 0 - floor.z, 0] };
}

/**
 * What the ray from `camera` through `at` (−1 to 1 across the canvas, y up) strikes first among
 * `buildScene`'s meshes, else the floor (a car place stands on it); null for nothing.
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

  if (nearest === undefined) return onFloor(ray);

  // A module lies on its roof: a tie in depth goes to the module.
  const { object, point, instanceId } =
    hits.find(
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's hit, read only.
      (hit) => hit.object.name === "module" && hit.distance <= nearest.distance + ON_ROOF,
    ) ?? nearest;

  // The modules are one instanced mesh, in the panels' order (ADR 20 Rendering).
  const { grid, module } = (object.name === "module" ? panels[instanceId ?? -1] : undefined) ?? {};
  const struck: Point = [point.x, 0 - point.z, point.y];

  if (grid !== undefined) {
    return module === undefined
      ? { kind: "grid", grid, point: struck }
      : { kind: "grid", grid, module, point: struck };
  }

  const index = group.getObjectsByProperty("name", object.name).indexOf(object);

  if (object.name === "equipment" || object.name === "opening") return { kind: object.name, index };

  return { kind: "point", point: struck };
}
