// What a year's run is given beside the plant and what it answers of its losses (ADR 17): soiling,
// cables and a warranty in, the loss chain from the planes to the grid out.

import type { Energy } from "./index.d.ts";

/** What the caller supplies a year's run beside the plant; never part of it. */
export interface RunLosses {
  /** Of the light reaching the cells, in %; absent, no soiling loss is computed. */
  readonly soiling?: number;
  /** Never part of the plant (ADR 17); absent, no cable loss is computed. */
  readonly cables?: {
    /** By string position; null where a string has none. */
    readonly dc?: readonly (Copper | null)[];
    /** By inverter device id; only a typed inverter's counts. */
    readonly ac?: Readonly<Record<number, Copper & { readonly threePhase: boolean }>>;
  };
  /** A linear performance warranty in %: the plant's yield for each of `years` years. */
  readonly warranty?: {
    readonly firstYear: number;
    readonly yearly: number;
    readonly years: number;
  };
}

/** A copper cable at 56 m/(Ω·mm²): its length one way in metres, each conductor's cross-section in mm². */
export interface Copper {
  readonly length: number;
  readonly crossSection: number;
}

/** A loss's stable id (ADR 17), in the chain's order. */
export type LossId =
  | "horizon"
  | "beam_shading"
  | "diffuse_shading"
  | "incidence"
  | "soiling"
  | "irradiance_level"
  | "temperature"
  | "string"
  | "mismatch"
  | "mppt_limits"
  | "dc_cable"
  | "inverter"
  | "clipping"
  | "ac_cable";

/** One loss: its names, the energy after it and the energy it took, which may be negative. */
export interface LossStep {
  readonly id: LossId;
  readonly en: string;
  readonly de: string;
  readonly after: Energy;
  readonly lost: Energy;
}

/** Irradiation on the planes at the datasheet's efficiency, then each loss the run computed; a
 * loss it did not compute is absent. The losses sum to the planes less the last step's after. */
export interface LossChain {
  readonly planes: Energy;
  readonly steps: readonly LossStep[];
}
