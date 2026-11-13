// What laying modules and wiring strings draw over the roof (ADR 20): a selected face's free cells
// in the brand colour, the selected module's outline, and the picked string's wiring in its tint
// from a start marker. Built anew for each step; the free cells are what a press may strike.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js objects, built in place. */
import {
  BufferGeometry,
  type Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { fan } from "../scene/surfaces.ts";
import type { At } from "./modules.ts";
import type { CellPlace, Point } from "./pv.ts";
import { stringColour, toThree } from "./scene.ts";

/** What the overlay shows: a face's cells, or a string's wiring. */
export type Shown =
  | {
      readonly kind: "modules";
      /** The cells a press may place a module in. */
      readonly free: readonly CellPlace[];
      readonly selected?: CellPlace | undefined;
    }
  | {
      readonly kind: "string";
      readonly string: number;
      /** Its modules' centres, along its wiring. */
      readonly path: readonly Point[];
    };

/** Metres the cells float over the roof, clear of its tiles. */
const LIFT = 0.03;

/** The start marker's radius, in metres. */
const START = 0.14;

/** Over everything the scene draws, as the handles. */
const ON_TOP = 10;

/** Metres a cell may lie behind what the ray strikes first, by depth rounding. */
const ON_ROOF = 0.05;

/** Each free cell's mesh, by the cell it stands for. */
const CELLS = new WeakMap<Object3D, At>();

/** The free cell of `shown` the ray from `camera` through `at` (−1 to 1, y up) strikes, unless
 * something of the scene `drawn` stands before it. */
export function freeCellAt(
  shown: Group,
  drawn: Group,
  camera: PerspectiveCamera,
  at: readonly [number, number],
): At | undefined {
  const ray = new Raycaster();

  ray.setFromCamera(new Vector2(...at), camera);

  const [cell] = ray.intersectObjects(
    shown.children.filter((part) => CELLS.has(part)),
    false,
  );

  const [nearest] = ray.intersectObject(drawn, true);

  if (cell === undefined || (nearest !== undefined && nearest.distance + ON_ROOF < cell.distance)) {
    return undefined;
  }

  return CELLS.get(cell.object);
}

/** The cell's corners in three.js's frame, lifted off the roof along its normal. */
function lifted({ corners }: CellPlace): Vector3[] {
  const points = corners.map((corner) => new Vector3(...toThree(corner)));
  const [a, b, , d] = points;

  if (a === undefined || b === undefined || d === undefined) return points;

  const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();

  // Up, whichever way the crate wound the corners.
  if (normal.y < 0) normal.negate();

  return points.map((point) => point.addScaledVector(normal, LIFT));
}

function outline(cell: CellPlace, colour: Color, opacity: number): LineLoop {
  return new LineLoop(
    new BufferGeometry().setFromPoints(lifted(cell)),
    new LineBasicMaterial({ color: colour, transparent: true, opacity, toneMapped: false }),
  );
}

/** A free cell: a faint fill a press strikes, and its outline. */
function free(cell: CellPlace, colour: Color): Object3D[] {
  const geometry = new BufferGeometry();
  const points = lifted(cell);

  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(fan(points.map(({ x, y, z }) => [x, y, z] as const)).flat(), 3),
  );

  const fill = new Mesh(
    geometry,
    new MeshBasicMaterial({
      color: colour,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      toneMapped: false,
    }),
  );

  fill.material.side = DoubleSide;
  CELLS.set(fill, { row: cell.row, column: cell.column });

  return [fill, outline(cell, colour, 0.55)];
}

/** A string's wiring: a thin line through its modules' centres and a marker at its start. */
function wired(string: number, path: readonly Point[]): Object3D[] {
  const colour = stringColour(string);
  const points = path.map((point) => new Vector3(...toThree(point)));
  const [first] = points;

  if (first === undefined) return [];

  const material = { color: colour, depthTest: false, depthWrite: false, toneMapped: false };
  const start = new Mesh(new SphereGeometry(START, 16, 12), new MeshBasicMaterial(material));

  start.position.copy(first);

  const line = new Line(
    new BufferGeometry().setFromPoints(points),
    new LineBasicMaterial(material),
  );

  return [line, start];
}

/** The overlay's objects, over the scene. */
export function overlay(shown: Shown, brand: Color): Group {
  const group = new Group();

  const parts =
    shown.kind === "string"
      ? wired(shown.string, shown.path)
      : [
          ...shown.free.flatMap((cell) => free(cell, brand)),
          ...(shown.selected === undefined ? [] : [outline(shown.selected, brand, 1)]),
        ];

  if (parts.length > 0) group.add(...parts);

  group.traverse((part) => {
    part.renderOrder = ON_TOP;
  });

  return group;
}

/** Frees the overlay's geometries and materials. */
export function freeOverlay(group: Group): void {
  group.traverse((part) => {
    if (part instanceof Mesh || part instanceof Line) {
      const geometry: unknown = part.geometry;
      const material: unknown = part.material;

      if (geometry instanceof BufferGeometry) geometry.dispose();

      if (material instanceof MeshBasicMaterial || material instanceof LineBasicMaterial) {
        material.dispose();
      }
    }
  });
}
