// Laying, moving and removing modules on a roof face (ADR 20). Pure: each edit returns a new scene;
// the pv crate decides where a module lies and what fits.
import { withModules } from "./modules.ts";
import type { Scene, Spot } from "./pv.ts";

/** Grid `index` with a new, unwired module at each of `spots`. */
export function place(scene: Scene, index: number, spots: readonly Spot[]): Scene {
  return withModules(scene, index, (modules) => [
    ...modules,
    ...spots.map(({ across, up, landscape }) => ({ across, up, landscape, optimized: false })),
  ]);
}

/** Module `module` of grid `index` at another place, or turned. */
export function move(scene: Scene, index: number, module: number, to: Partial<Spot>): Scene {
  return withModules(scene, index, (modules) => {
    const before = modules[module];

    return before === undefined ? modules : modules.with(module, { ...before, ...to });
  });
}

/** Grid `index` without its module `module`. */
export function removeModule(scene: Scene, index: number, module: number): Scene {
  return withModules(scene, index, (modules) => modules.toSpliced(module, 1));
}
