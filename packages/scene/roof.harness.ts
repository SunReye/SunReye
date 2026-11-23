// Tracing a roof by clicks, as the person does, and its faces read back seen from above.

import { addLine, type Edited, type End, type ModuleGrid, type Scene } from "./index.js";

export const EMPTY: Scene = { north: 0, blocks: [], obstacles: [] };

/** Metres a click snaps within. */
export const REACH = 0.3;

/** The square of 4 m from the origin, clicked round to its first corner. */
export const SQUARE = [
  [0, 0],
  [0, 4],
  [4, 4],
  [4, 0],
  [0, 0],
] as const;

/** The scene an edit made; it fails the test when the edit was refused. */
export function made(edited: Edited): Scene {
  if ("refused" in edited) throw new Error(`refused: ${edited.refused}`);

  return edited.scene;
}

/** Clicks along `spots`, each joined to the last, as the person traces them. */
export function trace(scene: Scene, ...spots: readonly (readonly [number, number])[]): Scene {
  return clicks(scene, REACH, ...spots);
}

/** Clicks as `trace` does, each snapping within `reach` metres: closer in, a smaller reach. */
export function clicks(
  scene: Scene,
  reach: number,
  ...spots: readonly (readonly [number, number])[]
): Scene {
  let at = scene;
  let from: End | undefined;

  for (const [x, z] of spots) {
    if (from === undefined) from = { x, z };
    else {
      const edited = addLine(at, from, { x, z }, reach);

      at = made(edited);
      from = "refused" in edited ? from : { block: edited.block, point: edited.to };
    }
  }

  return at;
}

/** A corner's order key: lowest x, then lowest z. */
const key = ([x = 0, z = 0]: readonly number[]) => x * 1000 + z;

/** A face's corners seen from above, x and z, turned to start at its lowest corner so two
 * listings compare. */
function settled(face: readonly (readonly number[])[]): readonly (readonly number[])[] {
  const plan: readonly (readonly number[])[] = face.map(([x = Number.NaN, , z = Number.NaN]) => [
    x,
    z,
  ]);

  const first = plan.reduce((low, corner, i) => (key(corner) < key(plan[low] ?? []) ? i : low), 0);

  return [...plan.slice(first), ...plan.slice(0, first)];
}

/** Block `block`'s faces, each as `settled` gives it. */
export function outlines(scene: Scene, block = 0): (readonly (readonly number[])[])[] {
  return (scene.blocks[block]?.freeForm?.faces ?? []).map((face) => settled(face));
}

/** A grid of one module on face `face` of block 0. */
export function grid(face: number): ModuleGrid {
  return {
    block: 0,
    face,
    moduleType: 1,
    landscape: false,
    setback: 0,
    modules: [{ across: 0.5, up: 0.5, landscape: false }],
  };
}
