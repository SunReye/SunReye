// The pixel maths of the scene's two generated maps (ADR 20 Look: no texture files ship): a
// module's cells and the light a lit opening spills. Pure: no three.js and no DOM, so the same
// code can run in a worker.
import { module } from "./module-pixels.ts";
import { spill } from "./spill-pixels.ts";

export interface Pixels {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/** A group's maps by `<group>.<kind>`. */
export type Maps = Readonly<Record<string, Pixels>>;

export type Rgb = readonly [number, number, number];

/** One generator per group; each returns its maps by `<group>.<kind>`. */
export const GROUPS = { module, spill } satisfies Readonly<Record<string, () => Maps>>;

export type GroupName = keyof typeof GROUPS;
