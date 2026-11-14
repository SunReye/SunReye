// Windows and doors as the scene draws them (ADR 20 Openings): fitted on their walls by the pv
// crate, drawn only, never shading. At night some windows and the front door's light glow, and
// their light spills on the ground out from the wall: emissive maps and one decal, no light of their own.
import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
} from "three";
import type { Fitted, OpeningKind, Point } from "../builder/pv.ts";
import { glazed, spilled } from "./materials.ts";

/** Metres an opening's frame stands proud of its wall. */
const PROUD = 0.05;

/** A window sill and a door's canopy: how far each reaches past the opening, its thickness and
 * its depth, in metres. */
const SILL = { past: 0.06, thick: 0.04, deep: 0.12 } as const;
const CANOPY = { past: 0.25, thick: 0.06, deep: 0.8, over: 0.12 } as const;

/** The spill, in metres and metres per metre of sill height. Light leaves through the opening and
 * falls at an angle, so its patch begins `start` out from the wall and `slope` further per metre
 * of sill, is `reach` deep and `past` wider than the opening on each side, deeper by `stretch` and
 * wider by `spread` per metre, and fainter until none reaches the ground from `ceiling` up.
 * `lift` holds it clear of every ground surface. */
const SPILL = {
  start: 0.15,
  slope: 0.6,
  reach: 2.2,
  stretch: 1,
  past: 0.5,
  spread: 0.5,
  ceiling: 3,
  lift: 0.04,
} as const;

/** An emissive map at full strength: a lit room seen from the garden, not a lamp. */
const GLOW = 1.8;
const SPILL_OPACITY = 0.55;

/** The share of windows lit at night. */
const LIT = 0.6;

/** The frame's texel: every opening's map has its frame in its corner. */
const FRAME_UV = [0.01, 0.99] as const;

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Point): [number, number, number] => [east, up, 0 - north];

const add = (a: Point, b: Point, k: number): Point => [
  a[0] + b[0] * k,
  a[1] + b[1] * k,
  a[2] + b[2] * k,
];

/** Triangles and their UVs, gathered into one geometry. */
interface Triangles {
  readonly position: number[];
  readonly uv: number[];
}

/** A quad from its corners, counter-clockwise from the low left, with the map's whole face or
 * one texel of it. */
function quad(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- gathers into it.
  drawn: Triangles,
  [a, b, c, d]: readonly [Point, Point, Point, Point],
  whole: boolean,
): void {
  drawn.position.push(...[a, b, c, a, c, d].flatMap((point) => toThree(point)));
  // The maps' first row is their top.
  drawn.uv.push(
    ...(whole
      ? [0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]
      : Array.from({ length: 6 }, () => FRAME_UV).flat()),
  );
}

/** A box on the wall: from `low` it runs `across` to the right, `up` and `out`; its front shows
 * the map's face when `faced`, the rest the frame. */
function box(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- gathers into it.
  drawn: Triangles,
  low: Point,
  [right, out]: readonly [Point, Point],
  [across, up, deep]: readonly [number, number, number],
  faced: boolean,
): void {
  const at = (r: number, u: number, o: number): Point =>
    add(add(add(low, right, r * across), [0, 0, 1], u * up), out, o * deep);

  quad(drawn, [at(0, 0, 1), at(1, 0, 1), at(1, 1, 1), at(0, 1, 1)], faced);
  quad(drawn, [at(0, 1, 0), at(0, 1, 1), at(1, 1, 1), at(1, 1, 0)], false);
  quad(drawn, [at(0, 0, 0), at(1, 0, 0), at(1, 0, 1), at(0, 0, 1)], false);
  quad(drawn, [at(0, 0, 0), at(0, 0, 1), at(0, 1, 1), at(0, 1, 0)], false);
  quad(drawn, [at(1, 0, 1), at(1, 0, 0), at(1, 1, 0), at(1, 1, 1)], false);
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

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read only.
function geometry(drawn: Triangles): BufferGeometry {
  const made = new BufferGeometry();

  made.setAttribute("position", new Float32BufferAttribute(drawn.position, 3));
  made.setAttribute("uv", new Float32BufferAttribute(drawn.uv, 2));
  made.computeVertexNormals();

  return made;
}

/** The frame and leaf, with a window's sill or a front door's canopy. */
function body(opening: Fitted): BufferGeometry {
  const { width, height, along } = span(opening);
  const [low] = opening.corners;
  const frame = [along, opening.out] as const;
  const drawn: Triangles = { position: [], uv: [] };

  box(drawn, low, frame, [width, height, PROUD], true);

  if (opening.kind === "window" || opening.kind === "frenchWindow") {
    const under = add(add(low, along, -SILL.past), [0, 0, 1], -SILL.thick);

    box(drawn, under, frame, [width + SILL.past * 2, SILL.thick, SILL.deep], false);
  }

  if (opening.kind === "frontDoor") {
    const over = add(add(low, along, -CANOPY.past), [0, 0, 1], height + CANOPY.over);

    box(drawn, over, frame, [width + CANOPY.past * 2, CANOPY.thick, CANOPY.deep], false);
  }

  return geometry(drawn);
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

/** Where an opening's light lands: from `near` to `far` out from the wall, `past` beyond the
 * opening on each side, at `strength` of a ground-level opening's. */
interface Cast {
  readonly near: number;
  readonly far: number;
  readonly past: number;
  readonly strength: number;
}

/** The light an opening throws on the ground, or none from too high up. */
function cast({ corners: [low] }: Fitted): Cast | undefined {
  const sill = Math.max(0, low[2]);
  const strength = 1 - sill / SPILL.ceiling;

  if (strength <= 0) return undefined;

  const near = SPILL.start + sill * SPILL.slope;

  return {
    near,
    far: near + SPILL.reach + sill * SPILL.stretch,
    past: SPILL.past + sill * SPILL.spread,
    strength,
  };
}

/** The ground the lit openings light, out from their walls: one mesh. */
function spill(made: readonly (readonly [Fitted, Cast])[]): Mesh {
  const drawn: Triangles = { position: [], uv: [] };
  const colour: number[] = [];

  for (const [opening, { near, far, past, strength }] of made) {
    const { width, along } = span(opening);
    const [low] = opening.corners;
    const foot: Point = [low[0], low[1], SPILL.lift];
    const [left, right] = [add(foot, along, -past), add(foot, along, width + past)];
    const at = (side: Point, out: number): Point => add(side, opening.out, out);

    // Its map's first row is the edge nearest the wall.
    drawn.position.push(
      ...[
        at(left, near),
        at(left, far),
        at(right, far),
        at(left, near),
        at(right, far),
        at(right, near),
      ].flatMap((point) => toThree(point)),
    );
    drawn.uv.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
    colour.push(...Array.from({ length: 18 }, () => strength));
  }

  const patches = geometry(drawn);

  patches.setAttribute("color", new Float32BufferAttribute(colour, 3));

  const mesh = new Mesh(patches, spilled());

  mesh.name = "spill";
  mesh.visible = false;
  // Over the lawn, which is transparent where it fades.
  mesh.renderOrder = 1;

  return mesh;
}

/** Each opening as a mesh named "opening", in order, then the spill of those lit at night. */
export function openings(fitted: readonly Fitted[]): Object3D[] {
  const finishes = new Map<string, MeshStandardMaterial>();

  const finish = (kind: OpeningKind, on: boolean): MeshStandardMaterial => {
    const made = finishes.get(`${kind}:${on}`) ?? glazed(kind);

    finishes.set(`${kind}:${on}`, made);

    return made;
  };

  const meshes = fitted.map((opening) => {
    const mesh = new Mesh(body(opening), finish(opening.kind, lit(opening)));

    mesh.name = "opening";
    mesh.userData = { lit: lit(opening) };

    return mesh;
  });

  const spilling = fitted.flatMap((opening) => {
    const thrown = lit(opening) ? cast(opening) : undefined;

    return thrown === undefined ? [] : [[opening, thrown] as const];
  });

  return spilling.length === 0 ? meshes : [...meshes, spill(spilling)];
}

/** Turns the lamps of `drawn` on by `level`, 0 by day to 1 at night. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js lights in place.
export function lamps(drawn: Object3D, level: number): void {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  drawn.traverse((part) => {
    if (!(part instanceof Mesh)) return;

    if (part.name === "opening" && part.material instanceof MeshStandardMaterial) {
      part.material.emissiveIntensity = part.userData["lit"] === true ? level * GLOW : 0;
    }

    if (part.name === "spill" && part.material instanceof MeshBasicMaterial) {
      part.material.opacity = level * SPILL_OPACITY;
      part.visible = level > 0;
    }
  });
}
