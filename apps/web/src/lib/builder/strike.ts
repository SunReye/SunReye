// What a press or click in the drawn scene strikes (ADR 20): a module, a marker or a surface.
import {
  type Camera,
  type Group,
  type Intersection,
  type Object3D,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { buildingAt, seeThrough } from "../scene/around.ts";
import type { Point } from "./pv.ts";
import type { Panel } from "./scene.ts";

/** The lawn, which the studio draws outside `buildScene`'s meshes. */
const LAWN = new Plane(new Vector3(0, 1, 0), 0);

/** Metres a module may sit behind the roof it lies on, by depth-buffer rounding. */
const ON_ROOF = 0.05;

/** What a click in the scene struck: a module of a grid, a marker, an opening, an imported
 * building by its id, or a surface at a point. */
export type Hit =
  | {
      readonly kind: "grid";
      readonly grid: number;
      /** The module's position in its grid, when the panel names it. */
      readonly module?: number;
    }
  | { readonly kind: "equipment"; readonly index: number }
  | { readonly kind: "opening"; readonly index: number }
  | { readonly kind: "imported"; readonly building: number }
  | { readonly kind: "point"; readonly point: Point };

/** Where `ray` meets the lawn; null for a ray that never comes down to it. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's ray, read only.
function onLawn(ray: Raycaster): Hit | null {
  const lawn = ray.ray.intersectPlane(LAWN, new Vector3());

  return lawn === null ? null : { kind: "point", point: [lawn.x, 0 - lawn.z, 0] };
}

/** Whether `part` is drawn under `group`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects, read only.
function under(part: Object3D | null, group: Object3D): boolean {
  return part !== null && (part === group || under(part.parent, group));
}

/** The first hit that counts: a hidden building drawn see-through gives way to anything of the
 * scene's own behind it, so the house under it is still struck. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects, read only.
function first(hits: readonly Intersection[], group: Group): Intersection | undefined {
  const [nearest] = hits;

  return nearest !== undefined && seeThrough(nearest.object)
    ? // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's hit, read only.
      (hits.find((hit) => under(hit.object, group)) ?? nearest)
    : nearest;
}

/**
 * What the ray from `camera` through `at` (−1 to 1 across the canvas, y up) strikes first among
 * `buildScene`'s meshes and the imported surroundings drawn `around` them, else the lawn (a car
 * place stands on it); null for nothing.
 */
export function strike(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js updates its matrices.
  group: Group,
  panels: readonly Panel[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js updates its matrices.
  camera: Camera,
  at: readonly [number, number],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js updates its matrices.
  around?: Group,
): Hit | null {
  const ray = new Raycaster();

  ray.setFromCamera(new Vector2(...at), camera);

  const hits = ray.intersectObjects(around === undefined ? [group] : [group, around], true);
  const nearest = first(hits, group);

  if (nearest === undefined) return onLawn(ray);

  // A module lies on its roof: a tie in depth goes to the module.
  const { object, point, faceIndex } =
    hits.find(
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's hit, read only.
      (hit) => hit.object.name === "module" && hit.distance <= nearest.distance + ON_ROOF,
    ) ?? nearest;

  return (
    struck(group, panels, object, faceIndex) ?? {
      kind: "point",
      point: [point.x, 0 - point.z, point.y],
    }
  );
}

/** The imported building, module, marker or opening `object` is; null for any other surface. */
function struck(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects, read only.
  group: Group,
  panels: readonly Panel[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects, read only.
  object: Object3D,
  face: number | null | undefined,
): Hit | null {
  const building = buildingAt(object, face);

  if (building !== null) return { kind: "imported", building };

  const index = group.getObjectsByProperty("name", object.name).indexOf(object);
  const { grid, module } = panels[index] ?? {};

  if (object.name === "module" && grid !== undefined) {
    return module === undefined ? { kind: "grid", grid } : { kind: "grid", grid, module };
  }

  return object.name === "equipment" || object.name === "opening"
    ? { kind: object.name, index }
    : null;
}
