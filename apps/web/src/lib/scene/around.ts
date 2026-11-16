// A scene's imported surroundings as three.js objects (ADR 20 Look): the terrain with its ground
// finishes, the neighbours' buildings, the hedges and the trees, all in the scene's generated
// materials and fading out at the radius. Pure: the pv crate stood everything, this draws it.
import { Group, type Mesh, MeshStandardMaterial, type Object3D, Vector4 } from "three";
import { world } from "../builder/handles/frame.ts";
import type { Around, Standing } from "../builder/imported.ts";
import type { Face } from "../builder/pv.ts";
import { hedges, surface } from "../builder/scene.ts";
import { BAND, fadeAll, LEAST, reach, type Fade } from "./around-fade.ts";
import { terrain } from "./around-ground.ts";
import { grove } from "./around-trees.ts";
import * as finish from "./materials.ts";
import { level } from "./surfaces.ts";

export { masks } from "./around-ground.ts";

/** Where the import lies in the scene's frame, and its turn in degrees clockwise from above. */
export type Lie = Readonly<Record<"x" | "z" | "turn", number>>;

/** What the crate stood around a scene's blocks: the document by `key`, under the scene's
 * compass bearing `north`, lying at `lie`. */
export interface Stood {
  readonly around: Around;
  readonly key: string;
  readonly north: number;
  readonly lie: Lie;
}

/** The drawn surroundings. */
export interface Drawn {
  readonly group: Group;
  readonly fade: Fade;
}

/** Whether any corner of the building lies within `radius` of the middle. */
function within({ faces }: Standing, [east, north, radius]: readonly number[]): boolean {
  return faces.some(({ corners }) =>
    corners.some(([e, n]) => Math.hypot(e - (east ?? 0), n - (north ?? 0)) <= (radius ?? 0)),
  );
}

/** One mesh of many buildings' faces, which tells the building of each of its triangles. */
function merged(
  parts: readonly (readonly [number, readonly Face[]])[],
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- set up, then drawn.
  material: MeshStandardMaterial,
  repeat: readonly [number, number],
): Mesh[] {
  const faces = parts.flatMap(([, own]) => own);

  if (faces.length === 0) return [];

  const mesh = surface("wall", faces, material, repeat);

  mesh.name = "neighbour";
  mesh.userData["ids"] = parts.flatMap(([id, own]) =>
    own.flatMap(({ corners }) => Array.from({ length: Math.max(corners.length - 2, 0) }, () => id)),
  );
  // A see-through building casts nothing.
  mesh.castShadow = mesh.receiveShadow = material.depthWrite;
  mesh.userData["seeThrough"] = !material.depthWrite;

  return [mesh];
}

/** The neighbours' buildings: walls in plaster, pitched roofs tiled, flat ones rendered; with
 * `ghosts` the hidden ones too, see-through, so a tap can show them again. */
function buildings(
  standing: readonly Standing[],
  middle: readonly number[],
  ghosts: boolean,
): Mesh[] {
  const near = standing.filter((building) => within(building, middle));
  const shown = near.filter(({ hidden }) => !hidden);

  const of = (keep: (face: Face) => boolean): (readonly [number, readonly Face[]])[] =>
    shown.map(({ id, faces }) => [id, faces.filter((face) => keep(face))]);

  const hidden = near.flatMap(({ id, hidden: out, faces }) => (out ? [[id, faces] as const] : []));

  return [
    ...merged(
      of(({ surface: kind }) => kind === "wall"),
      finish.plaster(),
      finish.REPEAT.plaster,
    ),
    ...merged(
      of((face) => face.surface === "roof" && !level(face)),
      finish.tiles(),
      finish.REPEAT.tiles,
    ),
    ...merged(
      of((face) => face.surface === "roof" && level(face)),
      finish.render(),
      finish.REPEAT.render,
    ),
    ...(ghosts
      ? merged(
          hidden,
          new MeshStandardMaterial({ color: 0x8a8f98, opacity: 0.16, depthWrite: false }),
          finish.REPEAT.render,
        )
      : []),
  ];
}

/**
 * The surroundings the crate stood `around` the blocks. `key` names what the ground's masks were
 * painted for, the document: they are painted once for it. With `ghosts` the hidden buildings
 * are drawn see-through.
 */
export function buildAround(around: Around, key: string, ghosts = false): Drawn {
  const middle = reach(around.terrain);
  const [east, north, radius] = middle;

  const fade: Fade = {
    value: new Vector4(east, 0 - north, radius, Math.max(radius * BAND, LEAST)),
  };

  const group = new Group();
  const hedged = hedges(around.hedges);

  for (const hedge of hedged) hedge.castShadow = hedge.receiveShadow = true;

  group.add(
    ...terrain(around, key),
    ...buildings(around.buildings, middle, ghosts),
    ...hedged,
    ...grove(around.trees),
  );
  group.name = "around";
  fadeAll(group, fade);

  return { group, fade };
}

/** The building a strike on `part` at triangle `face` lands on; null for anything else of the
 * surroundings. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
export function buildingAt(part: Object3D, face: number | null | undefined): number | null {
  const ids: unknown = part.userData["ids"];

  if (part.name !== "neighbour" || !Array.isArray(ids) || face === null || face === undefined) {
    return null;
  }

  const id: unknown = ids[face];

  return Number.isInteger(id) ? Number(id) : null;
}

/** Whether `part` is a hidden building, drawn see-through. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
export function seeThrough(part: Object3D): boolean {
  return part.userData["seeThrough"] === true;
}

/** Lays the surroundings drawn for the lie `stood` where `now` puts them, without drawing them
 * again: a drag moves and turns them whole. `north` is the scene's compass bearing. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js moves it in place.
export function settle({ group, fade }: Drawn, north: number, stood: Lie, now: Lie): void {
  const [from, , fromSouth] = world(north, [stood.x, 0, stood.z]);
  const [to, , toSouth] = world(north, [now.x, 0, now.z]);
  // three.js turns counter-clockwise seen from above.
  const angle = (-(now.turn - stood.turn) * Math.PI) / 180;
  const [sin, cos] = [Math.sin(angle), Math.cos(angle)];

  group.rotation.y = angle;
  group.position.set(
    to - (from * cos + fromSouth * sin),
    0,
    toSouth - (-from * sin + fromSouth * cos),
  );
  group.updateMatrixWorld();
  fade.value.x = to;
  fade.value.y = toSouth;
}
