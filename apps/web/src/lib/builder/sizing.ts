// MPPT window warnings and the longest string, as the pv crate reckons them (ADR 20): what the
// crate answers and its replies checked at the boundary.
import type { Capabilities, ModuleType } from "../api/core.ts";
import type { Wiring } from "./pv.ts";
import { unwrap, type Exported, type Reply } from "./replies.ts";

/** One MPPT input's limits, as the capabilities list them (ADR 9). */
export type InputLimits = Readonly<NonNullable<Capabilities["devices"][string]["inputs"]>[number]>;

/** Each inverter's inputs' limits in the inputs' order, by device id. */
export type Inverters = Readonly<Record<number, readonly InputLimits[]>>;

/** Where a layout leaves an MPPT input's limits; a string by its position in the layout. */
export type Sizing =
  | {
      /** Never starts in the cold, held under the window when hot, clipped over it in the cold. */
      readonly kind: "start" | "low" | "high";
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

export interface Sizer {
  /** The layout's MPPT window warnings: each string's own, then each input's. */
  readonly sizing: (
    moduleTypes: readonly Readonly<ModuleType>[],
    strings: readonly Wiring[],
    inverters: Inverters,
  ) => Sizing[];
  /** The most modules of `moduleType` in series that stay under the inverter's maximum DC input
   * voltage and the input's window at −10 °C; null without either limit. */
  readonly longest: (
    moduleType: Readonly<ModuleType>,
    maxInputVoltage: number | null,
    limits: InputLimits | null,
  ) => number | null;
}

const KINDS = new Set<unknown>(["start", "low", "high", "current", "uneven", "noInput"]);

const isWarning = (item: unknown): item is Sizing =>
  item instanceof Object && "kind" in item && KINDS.has(item.kind);

/** The glue crate's own shape is trusted past each warning's kind. */
function isSizing(value: unknown): value is Reply<Sizing[]> {
  if (!(value instanceof Object)) return false;

  if ("error" in value) return String(value.error) === value.error;

  return "ok" in value && Array.isArray(value.ok) && value.ok.every(isWarning);
}

function isCount(value: unknown): value is Reply<number | null> {
  if (!(value instanceof Object)) return false;

  if ("error" in value) return String(value.error) === value.error;

  return "ok" in value && (value.ok === null || Number.isInteger(value.ok));
}

/** The crate's answers through `call`. */
export function sizingCalls(call: (name: Exported, input: string) => string): Sizer {
  return {
    sizing: (moduleTypes, strings, inverters) =>
      unwrap(call("sizing", JSON.stringify({ moduleTypes, strings, inverters })), isSizing),
    longest: (moduleType, maxInputVoltage, limits) =>
      unwrap(call("longest", JSON.stringify({ moduleType, maxInputVoltage, limits })), isCount),
  };
}
