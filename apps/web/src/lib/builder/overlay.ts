// What laying modules and wiring strings draw over the roof (ADR 20): a selected face's roof outside
// its setback and under its chimneys shaded, the ghost modules under the pointer in the brand colour
// or red where they do not fit, the selected module's outline, and the picked string's wiring in its
// tint from a start marker. Built anew for each step; it only shows, a press strikes the roof under
// it.
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
  SphereGeometry,
  Vector3,
} from "three";
import { fan } from "../scene/surfaces.ts";
import type { Footprint, Ghost, LaidGrid, Point } from "./pv.ts";
import { stringColour, toThree } from "./scene.ts";

/** What the overlay shows: a face's modules being laid, or a string's wiring. */
export type Shown =
  | {
      readonly kind: "modules";
      /** The roof modules may not lie on. */
      readonly shade: LaidGrid;
      readonly selected?: Footprint | undefined;
      /** The modules not laid yet. */
      readonly ghosts?: readonly Ghost[];
    }
  | {
      readonly kind: "string";
      readonly string: number;
      /** Its modules' centres, along its wiring. */
      readonly path: readonly Point[];
    };

/** The overlay's colours: the brand's, and the one of what does not fit. */
export interface Tints {
  readonly brand: Color;
  readonly unfit: Color;
}

/** Metres the overlay floats over the roof, clear of its tiles. */
const LIFT = 0.03;

/** Metres a ghost floats over the roof: over the modules' glass. */
const OVER = 0.06;

/** The start marker's radius, in metres. */
const START = 0.14;

/** Over everything the scene draws, as the handles. */
const ON_TOP = 10;

/** The shaded roof: black, faint enough to read the tiles through. */
const SHADE = { color: 0x000000, opacity: 0.38 } as const;

/** A flat polygon's corners in three.js's frame, lifted `by` metres off the roof along its
 * normal. */
function lifted(corners: readonly Point[], by = LIFT): Vector3[] {
  const points = corners.map((corner) => new Vector3(...toThree(corner)));
  const [a, b] = points;
  const d = points.at(-1);

  if (a === undefined || b === undefined || d === undefined) return points;

  const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(d, a)).normalize();

  // Up, whichever way the crate wound the corners.
  if (normal.y < 0) normal.negate();

  return points.map((point) => point.addScaledVector(normal, by));
}

function outline(corners: readonly Point[], colour: Color, by = LIFT): LineLoop {
  return new LineLoop(
    new BufferGeometry().setFromPoints(lifted(corners, by)),
    new LineBasicMaterial({ color: colour, transparent: true, toneMapped: false }),
  );
}

/** Convex polygons filled in one colour; they never write depth, so what lies under them shows. */
function filled(
  polygons: readonly (readonly Vector3[])[],
  { color, opacity }: { readonly color: Color | number; readonly opacity: number },
): Mesh {
  const geometry = new BufferGeometry();

  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      polygons.flatMap((points) => fan(points.map(({ x, y, z }) => [x, y, z] as const)).flat()),
      3,
    ),
  );

  return new Mesh(
    geometry,
    new MeshBasicMaterial({
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
    }),
  );
}

/** The roof no module may lie on: the band between the face's edge and its setback, the whole face
 * where the setback leaves none, and the chimneys' footprints. */
function shaded({ outline: edge, inset, blocked }: LaidGrid): Mesh {
  const outer = lifted(edge);
  const inner = inset === null ? null : lifted(inset);

  const band =
    inner === null
      ? [outer]
      : outer.flatMap((from, i) => {
          const j = (i + 1) % outer.length;
          const [to, within, before] = [outer[j], inner[j], inner[i]];

          return to === undefined || within === undefined || before === undefined
            ? []
            : [[from, to, within, before]];
        });

  return filled([...band, ...blocked.map((corners) => lifted(corners))], SHADE);
}

/** A module not laid yet: a fill and an outline, red where it does not fit. */
function ghost({ corners, fits }: Ghost, { brand, unfit }: Tints): Object3D[] {
  const colour = fits ? brand : unfit;

  return [
    filled([lifted(corners, OVER)], { color: colour, opacity: 0.35 }),
    outline(corners, colour, OVER),
  ];
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
export function overlay(shown: Shown, tints: Tints): Group {
  const group = new Group();

  const parts =
    shown.kind === "string"
      ? wired(shown.string, shown.path)
      : [
          shaded(shown.shade),
          ...(shown.selected === undefined
            ? []
            : [outline(shown.selected.corners, tints.brand, OVER)]),
          ...(shown.ghosts ?? []).flatMap((item) => ghost(item, tints)),
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
