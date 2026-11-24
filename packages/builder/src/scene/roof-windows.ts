// Roof windows and existing PV as the scene draws them (ADR 20): a framed pane lying flush in its
// roof face, placed by the pv crate, drawn only, never shading. Pure: no DOM.
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  type MeshStandardMaterial,
} from "three";
import type { Point } from "../builder/pv.ts";
import { normal, unit, type Vector } from "../builder/vector.ts";
import { clay, darkGlass, existingField } from "./materials.ts";

/** Metres: the frame's width, and how far the frame and the glass stand over the roof. */
const FRAME = 0.06;
const PROUD = { frame: 0.05, glass: 0.03 } as const;

const moved = (from: Vector, by: Vector, metres: number): Vector => [
  from[0] + by[0] * metres,
  from[1] + by[1] * metres,
  from[2] + by[2] * metres,
];

const toward = (from: Vector, to: Vector): Vector =>
  unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);

/** East, north, up to three.js: x east, y up, z south. */
const toThree = ([east, north, up]: Vector): Vector => [east, up, 0 - north];

type Quad = readonly [Vector, Vector, Vector, Vector];

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- set up, then drawn.
function mesh(quads: readonly Quad[], material: MeshStandardMaterial): Mesh {
  const geometry = new BufferGeometry();

  const position = quads.flatMap(([a, b, c, d]) =>
    [a, b, c, a, c, d].flatMap((point) => toThree(point)),
  );

  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.computeVertexNormals();
  // Double-sided: the crate does not promise a winding.
  material.side = DoubleSide;

  return new Mesh(geometry, material);
}

/** A pane's corners moved in from its edges by `inset` metres and off the roof by `proud`. */
function ring([a, b, c, d]: Quad, inset: number, proud: number): Quad {
  const [across, up, out] = [toward(a, b), toward(a, d), normal([a, b, c])];

  const at = (corner: Vector, right: number, rise: number): Vector =>
    moved(moved(moved(corner, across, right * inset), up, rise * inset), out, proud);

  return [at(a, 1, 1), at(b, -1, 1), at(c, -1, -1), at(d, 1, -1)];
}

/** One pane named `name`: its frame, standing a little over the roof, round `inner`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- set up, then drawn.
function framed(pane: Quad, inner: MeshStandardMaterial, name: string): Mesh {
  const foot = ring(pane, 0, 0);
  const rim = ring(pane, 0, PROUD.frame);
  const lip = ring(pane, FRAME, PROUD.frame);

  // The frame's top between its rim and its lip, and its sides down to the roof.
  const sides = ([0, 1, 2, 3] as const).flatMap((i): Quad[] => {
    const j = (i + 1) % 4;
    const corner = (of: Quad, at: number): Vector => of[at] ?? pane[0];

    return [
      [corner(rim, i), corner(rim, j), corner(lip, j), corner(lip, i)],
      [corner(foot, i), corner(foot, j), corner(rim, j), corner(rim, i)],
    ];
  });

  const frame = mesh(sides, clay());

  const glass = mesh([ring(pane, FRAME, PROUD.glass)], inner);

  glass.name = name;
  frame.add(glass);
  frame.name = name;

  return frame;
}

/** Each pane framed round `inner` as a mesh named `name`, in order; one without four corners is
 * left out. */
function panes(
  quads: readonly (readonly Point[])[],
  inner: () => MeshStandardMaterial,
  name: string,
): Mesh[] {
  return quads.flatMap(([a, b, c, d]) =>
    a === undefined || b === undefined || c === undefined || d === undefined
      ? []
      : [framed([a, b, c, d], inner(), name)],
  );
}

/** Each roof window as a mesh named "roofWindow", in order. */
export const roofWindows = (quads: readonly (readonly Point[])[]): Mesh[] =>
  panes(quads, darkGlass, "roofWindow");

/** Each existing PV as a mesh named "existingPv", in order: its matte field in the same frame
 * (ADR 20 Existing PV). */
export const existingPv = (quads: readonly (readonly Point[])[]): Mesh[] =>
  panes(quads, existingField, "existingPv");
