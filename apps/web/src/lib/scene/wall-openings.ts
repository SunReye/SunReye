// Windows and doors as the scene draws them (ADR 20 Openings): plain frames round inset dark
// glass, fitted on their walls by the pv crate, drawn only, never shading. At night some windows
// and the front door's light glow, and their light spills on the ground out from the wall: an
// emissive pane and one decal, no light of their own.
import {
  BufferGeometry,
  Float32BufferAttribute,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  type Object3D,
} from "three";
import type { Face, Fitted, Point } from "../builder/pv.ts";
import { clay, darkGlass, leaf } from "./materials.ts";
import { spill } from "./spill.ts";

/** Metres: how far a frame stands proud of its wall, how wide its bars are, and how far out
 * from the wall its glass or leaf lies, inset in the frame. */
const PROUD = 0.05;
const BAR = 0.07;
const INSET = 0.012;

/** The share of a front door's height its fanlight takes, above the leaf. */
const FANLIGHT = 0.22;

/** A window sill and a door's canopy: how far each reaches past the opening, its thickness and
 * its depth, in metres. */
const SILL = { past: 0.06, thick: 0.04, deep: 0.12 } as const;
const CANOPY = { past: 0.25, thick: 0.06, deep: 0.8, over: 0.12 } as const;

/** A lit pane at full strength: a lit room seen from the garden, not a lamp. */
const GLOW = 1.8;
const SPILL_OPACITY = 0.55;

/** The share of windows lit at night. */
const LIT = 0.6;

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Point): [number, number, number] => [east, up, 0 - north];

const add = (a: Point, b: Point, k: number): Point => [
  a[0] + b[0] * k,
  a[1] + b[1] * k,
  a[2] + b[2] * k,
];

/** An opening's parts, each drawn in its own material: the frame's bars, the glass, a door's
 * leaf. */
const PARTS = ["frame", "pane", "leaf"] as const;

/** Each part's triangles, as positions in three.js's frame. */
type Drawn = Readonly<Record<(typeof PARTS)[number], readonly number[]>>;

/** A quad from its corners, counter-clockwise from the low left. */
function quad([a, b, c, d]: readonly [Point, Point, Point, Point]): number[] {
  return [a, b, c, a, c, d].flatMap((point) => toThree(point));
}

/** A point on an opening's wall: `r` metres to the right of its low left corner, `u` up and `o`
 * out. */
type At = (r: number, u: number, o: number) => Point;

/** A box on the wall from `[r, u]`, `across` wide, `up` high and `deep` out: its front and its
 * four sides. */
function box(
  at: At,
  [r, u]: readonly [number, number],
  [across, up, deep]: readonly [number, number, number],
): number[] {
  const [right, top] = [r + across, u + up];

  return [
    ...quad([at(r, u, deep), at(right, u, deep), at(right, top, deep), at(r, top, deep)]),
    ...quad([at(r, top, 0), at(r, top, deep), at(right, top, deep), at(right, top, 0)]),
    ...quad([at(r, u, 0), at(right, u, 0), at(right, u, deep), at(r, u, deep)]),
    ...quad([at(r, u, 0), at(r, u, deep), at(r, top, deep), at(r, top, 0)]),
    ...quad([at(right, u, deep), at(right, u, 0), at(right, top, 0), at(right, top, deep)]),
  ];
}

/** A flat sheet in the frame, a little out from the wall: glass, or a leaf. */
function sheet(
  at: At,
  [r, u]: readonly [number, number],
  [across, up]: readonly [number, number],
): number[] {
  return quad([
    at(r, u, INSET),
    at(r + across, u, INSET),
    at(r + across, u + up, INSET),
    at(r, u + up, INSET),
  ]);
}

/** An opening's width and height, and the unit vector along its wall to the right. */
interface Span {
  readonly width: number;
  readonly height: number;
  readonly along: Point;
}

function span({ corners: [low, right, , high] }: Fitted): Span {
  const width = Math.hypot(right[0] - low[0], right[1] - low[1]) || 1;

  return {
    width,
    height: high[2] - low[2],
    along: [(right[0] - low[0]) / width, (right[1] - low[1]) / width, 0],
  };
}

/** The frame's four bars round an opening `width` by `height`. */
function ring(at: At, width: number, height: number): number[] {
  return [
    ...box(at, [0, 0], [BAR, height, PROUD]),
    ...box(at, [width - BAR, 0], [BAR, height, PROUD]),
    ...box(at, [BAR, height - BAR], [width - BAR * 2, BAR, PROUD]),
    ...box(at, [BAR, 0], [width - BAR * 2, BAR, PROUD]),
  ];
}

/** What fills each kind's frame: a window's glass behind a mullion on a sill, a front door's
 * leaf under its fanlight and a canopy, a garage door's leaf. */
function filled(at: At, { kind }: Fitted, width: number, height: number): Drawn {
  const [across, up] = [width - BAR * 2, height - BAR * 2];

  if (kind === "garageDoor") {
    return { frame: [], pane: [], leaf: sheet(at, [BAR, 0], [across, height - BAR]) };
  }

  if (kind === "frontDoor") {
    const transom = height * (1 - FANLIGHT);

    return {
      frame: [
        ...box(at, [BAR, transom], [across, BAR, PROUD]),
        ...box(
          at,
          [-CANOPY.past, height + CANOPY.over],
          [width + CANOPY.past * 2, CANOPY.thick, CANOPY.deep],
        ),
      ],
      pane: sheet(at, [BAR, transom + BAR], [across, height - transom - BAR * 2]),
      leaf: sheet(at, [BAR, 0], [across, transom]),
    };
  }

  return {
    frame: [
      ...box(at, [(width - BAR) / 2, BAR], [BAR, up, PROUD]),
      ...box(at, [-SILL.past, -SILL.thick], [width + SILL.past * 2, SILL.thick, SILL.deep]),
    ],
    pane: sheet(at, [BAR, BAR], [across, up]),
    leaf: [],
  };
}

/** The frame and what fills it, as one geometry with a group for each part in `PARTS`. */
function body(opening: Fitted): BufferGeometry {
  const { width, height, along } = span(opening);
  const [low] = opening.corners;
  const at: At = (r, u, o) => add(add(add(low, along, r), [0, 0, 1], u), opening.out, o);
  const inside = filled(at, opening, width, height);
  const drawn: Drawn = { ...inside, frame: [...ring(at, width, height), ...inside.frame] };
  const made = new BufferGeometry();
  let from = 0;

  for (const [i, part] of PARTS.entries()) {
    made.addGroup(from, drawn[part].length / 3, i);
    from += drawn[part].length / 3;
  }

  made.setAttribute(
    "position",
    new Float32BufferAttribute(
      PARTS.flatMap((part) => drawn[part]),
      3,
    ),
  );
  made.computeVertexNormals();

  return made;
}

/** A number in 0..1 from where an opening sits: the same for it on every build. */
function chance({ corners: [low] }: Fitted): number {
  const [east, north, up] = low.map((v) => Math.round(v * 100));
  let hash = (((east ?? 0) * 73856093) ^ ((north ?? 0) * 19349663) ^ ((up ?? 0) * 83492791)) >>> 0;

  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995) >>> 0;

  return ((hash ^ (hash >>> 15)) >>> 0) / 0xffffffff;
}

/** Whether an opening is lit at night: the front door's light, and most windows, each by where
 * it sits, so the house looks lived in and the same every time. */
function lit(opening: Fitted): boolean {
  if (opening.kind === "garageDoor") return false;

  return opening.kind === "frontDoor" || chance(opening) < LIT;
}

/** Each opening as a mesh named "opening", in order, then the spill of those lit at night, on
 * the ground or on the one of `roofs` under them. */
export function openings(fitted: readonly Fitted[], roofs: readonly Face[]): Object3D[] {
  const [frame, door] = [clay(), leaf()];
  // The lit openings' glass glows together; the others' stays dark.
  const [glowing, dark] = [darkGlass(), darkGlass()];

  const meshes = fitted.map((opening) => {
    const materials: Material[] = [frame, lit(opening) ? glowing : dark, door];
    const mesh = new Mesh(body(opening), materials);

    mesh.name = "opening";
    mesh.userData = { lit: lit(opening) };

    return mesh;
  });

  const spilt = spill(
    fitted.filter((opening) => lit(opening)),
    roofs,
  );

  return spilt === undefined ? meshes : [...meshes, spilt];
}

/** Turns the lamps of `drawn` on by `level`, 0 by day to 1 at night. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
export function lamps(drawn: Object3D, level: number): void {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  drawn.traverse((part) => {
    if (!(part instanceof Mesh)) return;

    const materials: unknown[] = [part.material].flat();
    const glass = part.name === "opening" ? materials : [];

    for (const pane of glass) {
      if (pane instanceof MeshPhysicalMaterial) {
        pane.emissiveIntensity = part.userData["lit"] === true ? level * GLOW : 0;
      }
    }

    if (part.name === "spill" && part.material instanceof MeshBasicMaterial) {
      part.material.opacity = level * SPILL_OPACITY;
      part.visible = level > 0;
    }
  });
}
