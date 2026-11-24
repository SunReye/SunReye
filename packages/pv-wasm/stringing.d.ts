// What the `pv` crate reckons of strings (ADR 20): the MPPT inputs' limits, the window warnings, and
// what auto-stringing reads and answers, in the scene's types.

import type { Scene, Wiring } from "@sunreye/scene";
import type { ModuleType } from "./index.d.ts";

/** One MPPT input's limits, as the core's capabilities list them (ADR 9). */
export interface InputLimits {
  /** Amperes. */
  readonly maxCurrent: number;
  /** Volts: its window, and where it starts. */
  readonly minVoltage: number;
  readonly maxVoltage: number;
  readonly startVoltage: number;
}

/** Each inverter's inputs' limits in the inputs' order, by device id. */
export type Inverters = Readonly<Record<number, readonly InputLimits[]>>;

/** Where a layout leaves an MPPT input's limits; a string by its position in the layout. */
export type Sizing =
  | {
      /** Never starts in the cold, held under the window when hot, clipped over it in the cold;
       * open-circuit over the inverter's maximum in the cold. */
      readonly kind: "start" | "low" | "high" | "open";
      readonly string: number;
      readonly volts: number;
      readonly limit: number;
    }
  | {
      readonly kind: "current";
      readonly device: number;
      readonly input: number;
      readonly amperes: number;
      readonly limit: number;
    }
  | { readonly kind: "uneven"; readonly device: number; readonly input: number }
  | { readonly kind: "noInput"; readonly string: number };

/** A string as auto-stringing reads and makes it. */
export type Strand = Readonly<Pick<Wiring, "moduleType" | "device" | "input" | "modules">>;

/** What auto-stringing reads (ADR 20): the scene, its module types, the inverter the new strings
 * go to by device, each of its limits where known, and the layout's strings so far, which the new
 * ones follow. */
export interface Stringing {
  readonly scene: Scene;
  readonly moduleTypes: readonly ModuleType[];
  readonly device: number;
  readonly inverter: {
    /** Volts. */
    readonly maxInputVoltage: number | null;
    /** In the inputs' order; null where the inverter lists none. */
    readonly inputs: readonly InputLimits[] | null;
  };
  readonly taken: readonly Strand[];
}

/** A proposal: the scene with modules wired into the new strings, and how many stay in none. */
export interface Strung {
  readonly scene: Scene;
  readonly strings: Strand[];
  readonly left: number;
}
