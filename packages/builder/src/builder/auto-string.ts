// Auto-stringing (ADR 20): a roof face's modules in no string, run in a serpentine row by row from
// the lower left and cut into as few new strings as the inverter's limits allow. The pv crate cuts
// them (`autoStringFace`), as it does for a consumer without the builder; this names the new
// strings as the builder adds one.
import type { ModuleType } from "@sunreye/scene";
import type { Checking } from "./checks.ts";
import { addString, inNoString, withModules, type Draft } from "./modules.ts";
import type { GridModule, Scene } from "./pv.ts";

/** A proposal: the draft with the new strings, and how many modules no equal cut could hold. */
export interface Strung {
  readonly draft: Draft;
  readonly left: number;
}

/** Why nothing is proposed: the inverter has no MPPT input without a string. */
export interface Unstrung {
  readonly refused: "input";
}

/** What auto-stringing reads besides the draft: the crate, each inverter's limits and the module
 * types. */
export interface Stringing extends Checking {
  readonly moduleTypes: readonly Readonly<ModuleType>[];
}

/** `module`, in no string, as the crate wired it: its place along its string, its other fields as
 * wiring keeps them; a module already wired stays as it is. */
function rewired(
  module: Readonly<GridModule>,
  wired: Readonly<GridModule> | undefined,
): GridModule {
  const { across, up, landscape, optimized } = module;
  const kept = { across, up, landscape, optimized: optimized ?? false };
  const string = wired?.string ?? undefined;

  return !inNoString(module) || string === undefined
    ? module
    : { ...kept, string, order: wired?.order ?? 0 };
}

/** The draft's scene with grid `grid`'s modules wired as in `strung`, the crate's answer. */
const wiredAs = (scene: Scene, grid: number, strung: Scene): Scene =>
  withModules(scene, grid, (modules) =>
    modules.map((module, i) => rewired(module, strung.grids?.[grid]?.modules[i])),
  );

/** The crate's cut of grid `grid`'s modules in no string, onto inverter `device`'s free inputs. */
const cutOn = (
  draft: Draft,
  grid: number,
  { pv, limits, inputs, moduleTypes }: Stringing,
  device: number,
) =>
  pv.autoStringFace(
    {
      scene: draft.scene,
      moduleTypes,
      device,
      inverter: { maxInputVoltage: limits[device] ?? null, inputs: inputs[device] ?? null },
      taken: draft.strings,
    },
    grid,
  );

/** Grid `grid`'s modules in no string as new strings on the first inverter that lists its inputs,
 * else the first string's: on its inputs that carry no string, no more in parallel than an input's
 * current carries. The proposal, why there is none, or null where the grid holds no such module.
 * Wired modules stay as they are. */
export function strungOn(
  draft: Draft,
  grid: number,
  stringing: Stringing,
  name: (number: number) => string,
): Strung | Unstrung | null {
  const device = Number(Object.keys(stringing.inputs)[0] ?? draft.strings[0]?.device ?? 1);
  const laid = draft.scene.grids?.[grid];

  // A new string as the builder adds one: wired like the first.
  const like = laid && addString(draft, "", laid.moduleType).strings.at(-1);

  if (like === undefined) return null;

  const strung = cutOn(draft, grid, stringing, device);

  if (strung === null || "refused" in strung) return strung;

  const before = draft.strings.length;

  const made = strung.strings.map(({ input }, nth) => ({
    ...like,
    name: name(before + nth + 1),
    device,
    input,
  }));

  return {
    draft: {
      scene: wiredAs(draft.scene, grid, strung.scene),
      strings: [...draft.strings, ...made],
    },
    left: strung.left,
  };
}
