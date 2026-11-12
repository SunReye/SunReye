// The builder's live checks before saving (ADR 20), worded: a module the core would refuse, and a
// string whose open-circuit voltage at −10 °C, as the pv crate reckons it, exceeds its inverter's
// maximum DC input voltage. That one warns, never refuses: the plant may already exist.
import type { Capabilities, ModuleType } from "../api/core.ts";
import { m } from "../paraglide/messages.js";
import { painted, type Draft } from "./modules.ts";
import type { Misplaced, Pv } from "./pv.ts";

/** Maximum DC input voltage in volts, by inverter device id. */
export type Limits = Readonly<Record<number, number>>;

/** The limits the core's capabilities list. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the API's generated type, read only.
export function limitsOf({ devices }: Pick<Capabilities, "devices">): Limits {
  return Object.fromEntries(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read only, as above.
    Object.entries(devices).flatMap(([id, support]) => {
      const { maxInputVoltage } = support;

      return maxInputVoltage === undefined || maxInputVoltage === null
        ? []
        : [[Number(id), maxInputVoltage] as const];
    }),
  );
}

/** What the checks find in one grid: the first module the core would refuse, and the strings
 * over their inverter's limit in the cold. */
export interface Checks {
  readonly misplaced: Misplaced | null;
  readonly cold: readonly Cold[];
}

/** A string over its inverter's limit in the cold. */
export interface Cold {
  /** By position in the draft's strings. */
  readonly string: number;
  readonly volts: number;
  readonly limit: number;
  /** The warning, as the save's answer words it. */
  readonly text: string;
}

/** Each string of the draft over its inverter's limit, its modules counted from the scene. */
export function coldStrings(
  pv: Readonly<Pick<Pv, "coldVoltages">>,
  draft: Draft,
  moduleTypes: readonly Readonly<ModuleType>[],
  limits: Limits,
): Cold[] {
  const strings = draft.strings.map((string, i) => ({
    ...string,
    modules: painted(draft.scene, i).modules,
  }));

  return pv.coldVoltages(moduleTypes, strings).flatMap((volts, string) => {
    const device = draft.strings[string]?.device;
    const limit = device === undefined ? undefined : limits[device];

    return volts === null || limit === undefined || volts <= limit
      ? []
      : [{ string, volts, limit, text: coldText(draft.strings[string]?.name ?? "", volts, limit) }];
  });
}

function coldText(name: string, volts: number, limit: number): string {
  return m.builder_cold_voltage({
    name,
    voltage: Math.round(volts),
    limit: Math.round(limit),
  });
}

/** Why the core would refuse the grids, as the crate in the browser finds it. */
export function misplacedText(at: Misplaced): string {
  if (!("row" in at)) return at.kind === "face" ? m.misplaced_face() : m.misplaced_moduleType();

  const cell = { grid: at.grid + 1, row: at.row + 1, column: at.column + 1 };

  return at.kind === "setback" ? m.misplaced_setback(cell) : m.misplaced_overlap(cell);
}
