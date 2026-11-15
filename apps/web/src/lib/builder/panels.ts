// A placed module as the scene draws it (ADR 20 Look): a framed body proud of its roof, its cells
// glowing in its string's colour in the builder and by its share of peak on the dashboard. Pure.
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Group,
  Mesh,
  MeshPhysicalMaterial,
} from "three";
import * as finish from "../scene/materials.ts";
import { fan, moduleUvs } from "../scene/surfaces.ts";
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
  /** Its cell in that grid. */
  readonly row?: number;
  readonly column?: number;
}

/** The string glow: the solar colour, and how far the light it stands for shows (`daylight`). */
export interface Glow {
  readonly colour: number;
  readonly daylight: number;
}

/** Faint even at peak: the cells light, the glass stays black. */
const GLOW = 0.1;

/** Lights the group's modules by their strings' shares of peak, in `buildScene`'s order. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js recolours in place.
export function tint(group: Group, shares: readonly (number | null)[], glow: Glow): void {
  for (const [i, mesh] of group.getObjectsByProperty("name", "module").entries()) {
    if (mesh instanceof Mesh && mesh.material instanceof MeshPhysicalMaterial) {
      const share = shares[i] ?? 0;

      mesh.material.emissive.setHex(glow.colour);
      mesh.material.emissiveIntensity = share * share * GLOW * glow.daylight;
    }
  }
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

/** A module's top and its frame's four sides in three.js's frame, with their UVs. */
function framed(corners: readonly Point[]) {
  const up = normal(corners);

  const top = corners.map(([e, n, u]): Point => [
    e + up[0] * PROUD,
    n + up[1] * PROUD,
    u + up[2] * PROUD,
  ]);

  const sides = corners.flatMap((from, i) => {
    const j = (i + 1) % corners.length;
    const [to, above, over] = [corners[j] ?? from, top[j] ?? from, top[i] ?? from];

    return [from, to, above, from, above, over];
  });

  return {
    position: [...fan(top), ...sides].flatMap((point) => toThree(point)),
    // The sides take the frame's own texel, at the map's corner.
    uv: [...moduleUvs(corners), ...sides.flatMap(() => [0, 0])],
  };
}

export function panel({ corners, string }: Panel): Mesh {
  const geometry = new BufferGeometry();
  const { position, uv } = framed(corners);

  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();

  const material = finish.module();

  material.side = DoubleSide;
  material.emissive.setHex(stringColour(string));
  material.emissiveIntensity = IDENTITY;

  const mesh = new Mesh(geometry, material);

  mesh.name = "module";

  return mesh;
}
