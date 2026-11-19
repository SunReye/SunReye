// The placed modules as the scene draws them (ADR 20 Look, Rendering): framed bodies proud of
// their roof, all one instanced draw, each one's cells glowing in its string's colour in the
// builder and by its share of peak on the dashboard. Pure.
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Vector3,
} from "three";
import * as finish from "../scene/materials.ts";
import type { Point } from "./pv.ts";
import { normal } from "./vector.ts";

/** Strings by position, then again; distinct from roofs and the sky. */
const STRINGS = [0x1f5fbf, 0xe08a00, 0x2a9d5c, 0xb8336a, 0x6a4fb5, 0x0f8b8d] as const;
const UNASSIGNED = 0x6b6f76;

/** In the builder, a module's cells glow faintly in its string's colour. */
const IDENTITY = 0.3;

/** A placed module: its corners on the roof, and its string by position in the layout. */
export interface Panel {
  readonly corners: readonly Point[];
  readonly string?: number | null;
  /** The grid it lies in, by position in the scene; a click on it opens that face. */
  readonly grid?: number;
  /** Its position in that grid. */
  readonly module?: number;
  /** In the wiring mode its string's colour glows at full strength (ADR 20). */
  readonly bright?: boolean;
}

/** The string glow: the solar colour, and how far the light it stands for shows (`daylight`). */
export interface Glow {
  readonly colour: number;
  readonly daylight: number;
}

/** Faint even at peak: the cells light, the glass stays black. */
const GLOW = 0.1;

/** The least a producing string glows, as a share of peak squared: on a grey day the cells still
 * tell apart, where the tone mapping would leave a black slab. */
const FAINT = 0.2;

/** How far a string at `share` of its peak glows: by the share's square, and never under the
 * faint glow while it makes anything. */
const lit = (share: number): number => (share > 0 ? Math.max(share * share, FAINT) : 0);

/** The furthest any module's glow moves from the shares `from` to `to`, of its whole range. */
export function glowShift(
  from: readonly (number | null)[],
  to: readonly (number | null)[],
): number {
  return Math.max(0, ...to.map((share, i) => Math.abs(lit(share ?? 0) - lit(from[i] ?? 0))));
}

/** Each module's glow, its colour times its strength, as the instanced mesh carries it. */
const GLOWS = "moduleGlow";

/** Sets module `i`'s glow among `glows`: `hex` at `strength`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own buffer.
function glowAt(glows: InstancedBufferAttribute, i: number, hex: number, strength: number): void {
  const { r, g, b } = new Color(hex).multiplyScalar(strength);

  glows.setXYZ(i, r, g, b);
}

/** Lights the group's modules by their strings' shares of peak, in `buildScene`'s order. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js recolours in place.
export function tint(group: Group, shares: readonly (number | null)[], glow: Glow): void {
  const mesh = group.getObjectByName("module");
  const geometry: unknown = mesh instanceof InstancedMesh ? mesh.geometry : null;
  const glows: unknown = geometry instanceof BufferGeometry ? geometry.getAttribute(GLOWS) : null;

  if (!(glows instanceof InstancedBufferAttribute)) return;

  for (let i = 0; i < glows.count; i++) {
    glowAt(glows, i, glow.colour, lit(shares[i] ?? 0) * GLOW * glow.daylight);
  }

  glows.needsUpdate = true;
}

/** `stringColour` as CSS. */
export function stringCss(string: number | null | undefined): string {
  return `#${stringColour(string).toString(16).padStart(6, "0")}`;
}

/** The colour a string is drawn in, in the scene and in the builder's grid. */
export function stringColour(string: number | null | undefined): number {
  return string === null || string === undefined
    ? UNASSIGNED
    : (STRINGS[string % STRINGS.length] ?? UNASSIGNED);
}

/** A point in three.js's frame. */
export type Triple = readonly [number, number, number];

/** East, north, up to three.js: x east, y up, z south. */
export function toThree([east, north, up]: Point): [number, number, number] {
  // Never −0.
  return [east, up, 0 - north];
}

/** Metres a module's glass stands over its roof: its frame's depth. */
const PROUD = 0.035;

/** A unit square's corners, counter-clockwise from the origin. */
const SQUARE = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
] as const;

/** A body's triangles as they are gathered. */
interface Triangles {
  readonly position: number[];
  readonly normals: number[];
  readonly uv: number[];
}

type Triple3 = readonly [number, number, number];

/** Adds a face of four `corners`, wound counter-clockwise seen along `out` from outside; `mapped`,
 * it carries the cells, else the frame's own texel at the map's corner. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- gathered into.
function face(into: Triangles, corners: readonly Triple3[], out: Triple3, mapped: boolean): void {
  for (const corner of [0, 1, 2, 0, 2, 3]) {
    const [x = 0, y = 0, z = 0] = corners[corner] ?? [];

    into.position.push(x, y, z);
    into.normals.push(...out);
    into.uv.push(mapped ? x : 0, mapped ? y : 0);
  }
}

/**
 * Every module's body before it is placed: a box one unit each way. Its top and its bottom both
 * carry the cells, as a module laid with its corners wound the other way stands on its top; its
 * four sides take the frame's texel.
 */
function body(): BufferGeometry {
  const made: Triangles = { position: [], normals: [], uv: [] };
  const top = SQUARE.map(([x, y]): Triple3 => [x, y, 1]);
  const bottom = SQUARE.toReversed().map(([x, y]): Triple3 => [x, y, 0]);

  face(made, top, [0, 0, 1], true);
  face(made, bottom, [0, 0, -1], true);

  for (const [i, [x, y]] of SQUARE.entries()) {
    const [nextX, nextY] = SQUARE[(i + 1) % SQUARE.length] ?? [0, 0];

    const side: Triple3[] = [
      [x, y, 0],
      [nextX, nextY, 0],
      [nextX, nextY, 1],
      [x, y, 1],
    ];

    face(made, side, [nextY - y, x - nextX, 0], false);
  }

  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(made.position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(made.normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(made.uv, 2));

  return geometry;
}

/**
 * Where a module's body goes: the unit box onto its corners, its cells' long side along the
 * module's long side from its first corner, and 3.5 cm proud. Never mirrored: three.js lights a
 * mirrored instance from below, so corners wound the other way turn the box over instead.
 */
function placed([a, b, , d]: readonly Point[], up: Point): Matrix4 {
  if (a === undefined || b === undefined || d === undefined) return new Matrix4();

  const origin = new Vector3(...toThree(a));
  const toB = new Vector3(...toThree(b)).sub(origin);
  const toD = new Vector3(...toThree(d)).sub(origin);
  const [short, long] = toB.length() > toD.length() ? [toD, toB] : [toB, toD];
  const proud = new Vector3(...toThree(up)).multiplyScalar(PROUD);
  const turned = new Vector3().crossVectors(short, long).dot(proud) < 0;

  return new Matrix4()
    .makeBasis(short, long, turned ? proud.clone().negate() : proud)
    .setPosition(turned ? origin.add(proud) : origin);
}

/** How three.js's physical material starts its emissive light. */
const EMISSIVE = "vec3 totalEmissiveRadiance = emissive;";

/** The cells' material: its emissive light is each module's own glow, where three.js has one
 * colour for all a mesh draws. */
function cells() {
  const material = finish.module();

  material.side = DoubleSide;
  material.emissive.setHex(0xffffff);
  material.emissiveIntensity = 1;
  material.customProgramCacheKey = () => GLOWS;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches it in place.
  material.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes(EMISSIVE)) {
      throw new Error("three.js's emissive light has moved");
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute vec3 ${GLOWS};\nvarying vec3 vGlow;`,
      )
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvGlow = ${GLOWS};`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGlow;")
      .replace(EMISSIVE, `${EMISSIVE.slice(0, -1)} * vGlow;`);
  };

  return material;
}

/** The placed modules as one mesh, in `panels`' order; none for no module. */
export function modules(panels: readonly Panel[]): InstancedMesh[] {
  if (panels.length === 0) return [];

  const geometry = body();
  const glows = new InstancedBufferAttribute(new Float32Array(panels.length * 3), 3);
  const mesh = new InstancedMesh(geometry, cells(), panels.length);

  for (const [i, { corners, string, bright }] of panels.entries()) {
    const wired = bright === true && string !== null && string !== undefined;

    mesh.setMatrixAt(i, placed(corners, normal(corners)));
    glowAt(glows, i, stringColour(string), wired ? 1 : IDENTITY);
  }

  geometry.setAttribute(GLOWS, glows);
  mesh.name = "module";

  return [mesh];
}
