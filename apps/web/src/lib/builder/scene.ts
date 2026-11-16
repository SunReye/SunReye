// The scene as three.js objects, built from the pv crate's geometry (ADR 20). Pure: the drawing
// component only adds the group to its renderer.
import { CylinderGeometry, Group, Mesh, type Object3D } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as finish from "../scene/materials.ts";
import { fence, ground } from "../scene/surroundings.ts";
import { conifer, crown, hedges, level, surface } from "../scene/surfaces.ts";
import { roofWindows } from "../scene/roof-windows.ts";
import { openings } from "../scene/wall-openings.ts";
import { trim } from "../scene/trim.ts";
import { panel, toThree, type Panel } from "./panels.ts";
import type { Face, Geometry, Mount, Solid } from "./pv.ts";

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

function marker({ at }: Mount): Mesh {
  const box = new Mesh(new RoundedBoxGeometry(0.5, 0.6, 0.5, 3, 0.03), finish.equipment());

  box.position.set(...toThree(at));
  box.name = "equipment";

  return box;
}

/** Faces by their colour, the finish's own first; at least one group, so a kind is always drawn. */
function painted(faces: readonly Face[]): (readonly [string | undefined, readonly Face[]])[] {
  const groups = new Map<string | undefined, Face[]>([[undefined, []]]);

  for (const face of faces) {
    const group = groups.get(face.colour) ?? [];

    group.push(face);
    groups.set(face.colour, group);
  }

  return [...groups].filter(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the map's own entries, read only.
    ([colour, group]) => colour === undefined || group.length > 0,
  );
}

/** The scene's sections in drawing order, each built on call. */
function sections(geometry: Geometry, panels: readonly Panel[]): (() => Object3D[])[] {
  const faces = (kind: string): Face[] => geometry.faces.filter((face) => face.surface === kind);
  const roofs = faces("roof");

  return [
    () =>
      painted(faces("wall")).map(([colour, walls]) =>
        surface("wall", walls, finish.plaster(colour), finish.REPEAT.plaster),
      ),
    () => [
      ...painted(roofs.filter((face) => !level(face))).map(([colour, pitched]) =>
        surface("roof", pitched, finish.tiles(colour), finish.REPEAT.tiles),
      ),
      ...painted(roofs.filter((face) => level(face))).map(([colour, flat]) =>
        surface("flat", flat, finish.render(colour), finish.REPEAT.render),
      ),
      ...trim(roofs),
    ],
    () => [surface("obstacle", faces("obstacle"), finish.render(), finish.REPEAT.render)],
    () => {
      const chimneys = faces("chimney");

      return chimneys.length === 0
        ? []
        : [surface("chimney", chimneys, finish.render(), finish.REPEAT.render)];
    },
    () => hedges(faces("hedge")),
    () => [
      ...(geometry.ground ?? []).map((item, i) => ground(item, i)),
      ...(geometry.fences ?? []).map((item) => fence(item)),
    ],
    () => geometry.solids.map((obstacle, i) => solid(obstacle, i, geometry.solids)),
    () => panels.map((item) => panel(item)),
    () => (geometry.mounts ?? []).map((mount) => marker(mount)),
    () => openings(geometry.openings ?? [], roofs),
    () => roofWindows(geometry.roofWindows ?? []),
  ];
}

/** What lies on a surface that casts the same shadow: its own would only cost a draw. */
const FLAT: ReadonlySet<string> = new Set([
  "module",
  "ground",
  "trim",
  "opening",
  "spill",
  "soil",
  "roofWindow",
]);

/** Casts and catches the sun's shadow. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it in place.
function shadowed(part: Object3D): void {
  part.castShadow = !FLAT.has(part.name);
  part.receiveShadow = true;

  for (const child of part.children) shadowed(child);
}

/** Adds `parts` to `group`; three.js logs an error for an `add()` of nothing. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js adds in place.
function put(group: Group, parts: readonly Object3D[]): void {
  for (const part of parts) shadowed(part);

  if (parts.length > 0) group.add(...parts);
}

/** The scene's meshes: per surface kind, solid, ground, fence, placed module, marker, opening and
 * roof window. */
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

export {
  stringColour,
  stringCss,
  tint,
  toThree,
  type Glow,
  type Panel,
  type Triple,
} from "./panels.ts";
