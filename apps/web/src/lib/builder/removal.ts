// The draft without one of its objects (ADR 20): what "Entfernen" makes of it, in the inspector
// and in the context toolbar. Pure.
import { parent, type Level } from "./levels.ts";
import { withoutBlock, withoutString, type Draft } from "./modules.ts";
import { removeModule } from "./placing.ts";
import type { Scene } from "./pv.ts";

type Splice = (scene: Scene, index: number) => Scene;

/** The scene without the `index`th of the list an object's level names. */
const SPLICED: Partial<Record<Level["kind"], Splice>> = {
  chimney: (scene, at) => ({ ...scene, chimneys: (scene.chimneys ?? []).toSpliced(at, 1) }),
  roofWindow: (scene, at) => ({
    ...scene,
    roofWindows: (scene.roofWindows ?? []).toSpliced(at, 1),
  }),
  opening: (scene, at) => ({ ...scene, openings: (scene.openings ?? []).toSpliced(at, 1) }),
  obstacle: (scene, at) => ({ ...scene, obstacles: scene.obstacles.toSpliced(at, 1) }),
  surface: (scene, at) => ({ ...scene, surfaces: (scene.surfaces ?? []).toSpliced(at, 1) }),
  fence: (scene, at) => ({ ...scene, fences: (scene.fences ?? []).toSpliced(at, 1) }),
  marker: (scene, at) => ({ ...scene, equipment: (scene.equipment ?? []).toSpliced(at, 1) }),
  place: (scene, at) => ({ ...scene, carPlaces: (scene.carPlaces ?? []).toSpliced(at, 1) }),
};

/** The scene without the object at `level`; null for a level that names none to remove, and for
 * the scene's last block. */
function sceneWithout(scene: Scene, level: Level): Scene | null {
  const splice = SPLICED[level.kind];

  if (splice !== undefined && "index" in level) return splice(scene, level.index);

  if (level.kind === "block") {
    return scene.blocks.length > 1 ? withoutBlock(scene, level.index) : null;
  }

  if (level.kind !== "module") return null;

  const grid = (scene.grids ?? []).findIndex(
    (item) => item.block === level.block && item.face === level.face,
  );

  return grid < 0 ? null : removeModule(scene, grid, level.module);
}

/** The draft without the object at `level`; null where there is none to remove. A string takes
 * its modules' wiring with it. */
export function without(draft: Draft, level: Level): Draft | null {
  if (level.kind === "string") {
    return {
      scene: withoutString(draft.scene, level.index),
      strings: draft.strings.toSpliced(level.index, 1),
    };
  }

  const scene = sceneWithout(draft.scene, level);

  return scene && { ...draft, scene };
}

/** What "Entfernen" at `level` leaves: the draft without the object, and the level above it; null
 * where there is none to remove. */
export function removal(draft: Draft, level: Level): { draft: Draft; level: Level } | null {
  const next = without(draft, level);

  return next && { draft: next, level: parent(level) };
}
