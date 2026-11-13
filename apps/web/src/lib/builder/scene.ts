// The scene as three.js objects, built from the pv crate's geometry (ADR 20). Pure: the drawing
// component only adds the group to its renderer.
import {
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  type Object3D,
  MeshPhysicalMaterial,
  type MeshStandardMaterial,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as finish from "../scene/materials.ts";
import { fence, ground } from "../scene/surroundings.ts";
import { conifer, crown, fan, foliage, level, moduleUvs, uvs } from "../scene/surfaces.ts";
import type { Face, Geometry, Mount, Point, Solid } from "./pv.ts";

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

/** Each convex face as a fan of triangles. */
function triangles(faces: readonly Face[]): number[] {
  return faces.flatMap(({ corners }) => fan(corners).flatMap((point) => toThree(point)));
}

function surface(
  name: Face["surface"] | "flat",
  faces: readonly Face[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- set up, then drawn.
  material: MeshStandardMaterial,
  repeat: readonly [number, number],
): Mesh {
  const geometry = new BufferGeometry();

  geometry.setAttribute("position", new Float32BufferAttribute(triangles(faces), 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs(faces, repeat), 2));
  geometry.computeVertexNormals();

  // Double-sided: the crate does not promise a winding.
  material.side = DoubleSide;
  material.flatShading = true;

  const mesh = new Mesh(geometry, material);

  mesh.name = name;

  return mesh;
}

/** Whether a cylinder carries a crown straight above it: a trunk. */
function trunk(
  { base, radius }: Readonly<Solid & { kind: "cylinder" | "cone" }>,
  solids: readonly Solid[],
): boolean {
  return solids.some((other) => {
    const above =
      other.kind === "sphere" ? other.centre : other.kind === "cone" ? other.base : null;

    return (
      above !== null && Math.hypot(above[0] - base[0], above[1] - base[1]) <= Math.max(radius, 0.01)
    );
  });
}

/** A crown or a trunk, a chimney or a pole. */
function solid(obstacle: Solid, i: number, solids: readonly Solid[]): Mesh {
  if (obstacle.kind !== "cylinder") {
    const leaves =
      obstacle.kind === "sphere"
        ? crown(obstacle.radius, 7 + i * 101)
        : conifer(obstacle.radius, obstacle.height, 7 + i * 101);

    leaves.position.set(...toThree(obstacle.kind === "sphere" ? obstacle.centre : obstacle.base));
    leaves.name = "solid";

    return leaves;
  }

  const { base, radius, height } = obstacle;

  const upright = new Mesh(
    // A trunk tapers toward its crown.
    trunk(obstacle, solids)
      ? new CylinderGeometry(radius * 0.6, radius, height, 14)
      : new CylinderGeometry(radius, radius, height, 16),
    trunk(obstacle, solids) ? finish.bark() : finish.render(),
  );

  // three.js centres a cylinder on its position.
  upright.position.set(...toThree([base[0], base[1], base[2] + height / 2]));
  upright.name = "solid";

  return upright;
}

/** Hedges: a dark body under clusters of leaves. */
function hedges(faces: readonly Face[]): Mesh[] {
  if (faces.length === 0) return [];

  const body = surface("hedge", faces, finish.hedge(), finish.REPEAT.render);

  body.add(foliage(faces, 13));

  return [body];
}

function panel({ corners, string }: Panel): Mesh {
  const geometry = new BufferGeometry();

  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(triangles([{ surface: "roof", corners }]), 3),
  );
  geometry.setAttribute("uv", new Float32BufferAttribute(moduleUvs(corners), 2));
  geometry.computeVertexNormals();

  const material = finish.module();

  material.side = DoubleSide;
  material.emissive.setHex(stringColour(string));
  material.emissiveIntensity = IDENTITY;

  const mesh = new Mesh(geometry, material);

  mesh.name = "module";

  return mesh;
}

function marker({ at }: Mount): Mesh {
  const box = new Mesh(new RoundedBoxGeometry(0.5, 0.6, 0.5, 3, 0.03), finish.equipment());

  box.position.set(...toThree(at));
  box.name = "equipment";

  return box;
}

/** The scene's sections in drawing order, each built on call. */
function sections(geometry: Geometry, panels: readonly Panel[]): (() => Object3D[])[] {
  const faces = (kind: string): Face[] => geometry.faces.filter((face) => face.surface === kind);
  const roofs = faces("roof");

  return [
    () => [surface("wall", faces("wall"), finish.plaster(), finish.REPEAT.plaster)],
    () => [
      surface(
        "roof",
        roofs.filter((face) => !level(face)),
        finish.tiles(),
        finish.REPEAT.tiles,
      ),
      surface(
        "flat",
        roofs.filter((face) => level(face)),
        finish.render(),
        finish.REPEAT.render,
      ),
    ],
    () => [surface("obstacle", faces("obstacle"), finish.render(), finish.REPEAT.render)],
    () => hedges(faces("hedge")),
    () => [
      ...(geometry.ground ?? []).map((item, i) => ground(item, i)),
      ...(geometry.fences ?? []).map((item) => fence(item)),
    ],
    () => geometry.solids.map((obstacle, i) => solid(obstacle, i, geometry.solids)),
    () => panels.map((item) => panel(item)),
    () => (geometry.mounts ?? []).map((mount) => marker(mount)),
  ];
}

/** Adds `parts` to `group`; three.js logs an error for an `add()` of nothing. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds in place.
function put(group: Group, parts: readonly Object3D[]): void {
  if (parts.length > 0) group.add(...parts);
}

/** The scene's meshes: per surface kind, solid, ground, fence, placed module and marker. */
export function buildScene(geometry: Geometry, panels: readonly Panel[] = []): Group {
  const group = new Group();

  for (const section of sections(geometry, panels)) put(group, section());

  return group;
}

/**
 * The same, a section at a time, awaiting `pause` between them so the main thread is given back
 * (ADR 20 Loading).
 */
export async function buildSliced(
  geometry: Geometry,
  panels: readonly Panel[],
  pause: () => Promise<void>,
): Promise<Group> {
  const group = new Group();
  const [first, ...rest] = sections(geometry, panels);

  put(group, first?.() ?? []);

  for (const section of rest) {
    // One section per task: each waits for the last to be let go.
    // oxlint-disable-next-line eslint/no-await-in-loop -- sequential by design.
    await pause();
    put(group, section());
  }

  return group;
}

export { strike, type Hit } from "./strike.ts";
