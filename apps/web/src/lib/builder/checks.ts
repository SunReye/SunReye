// The builder's live checks before saving (ADR 20), worded: a module the core would refuse, and a
// string whose open-circuit voltage at −10 °C, as the pv crate reckons it, exceeds its inverter's
// maximum DC input voltage. That one warns, never refuses: the plant may already exist. And after a
// save, where the core points its refusal (ADR 9), worded beside the object it names.
import type { Capabilities, ModuleType, Problem } from "../api/core.ts";
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
  if (!("module" in at)) return at.kind === "face" ? m.misplaced_face() : m.misplaced_moduleType();

  const module = { grid: at.grid + 1, module: at.module + 1 };

  if (at.kind === "chimney") return m.misplaced_chimney(module);

  if (at.kind === "window") return m.misplaced_window(module);

  return at.kind === "setback" ? m.misplaced_setback(module) : m.misplaced_overlap(module);
}

/** A string's refusal: its position in the draft and the text shown on its level. */
export interface StringRefusal {
  readonly string: number;
  readonly text: string;
}

const STRING = /^\/strings\/(?<at>\d+)\/(?<field>\w+)$/u;

const STRING_FIELDS = new Map([
  ["optimized", m.field_optimized],
  ["tilt", m.field_tilt],
  ["azimuth", m.field_azimuth],
  ["loss", m.field_loss],
]);

/** The string `problem` points at, worded with its `names`; null for any other refusal. */
export function stringRefusal(
  problem: Readonly<Problem>,
  names: readonly string[],
): StringRefusal | null {
  const groups = STRING.exec(problem.pointer ?? "")?.groups;

  if (problem.problem !== "layout.value" || groups === undefined) return null;

  const string = Number(groups.at);
  const name = names[string] ?? String(string + 1);
  const field = groups.field ?? "";
  const label = STRING_FIELDS.get(field);

  if (field === "modules") return { string, text: m.refused_string_modules({ name }) };

  return { string, text: m.refused_string_value({ name, field: label?.() ?? field }) };
}

/** The datasheet value `problem` points at, worded with its row's `labels`; undefined for any
 * other refusal. */
export function valueRefusal(
  problem: Readonly<Problem>,
  labels: Readonly<Record<string, string>>,
): string | undefined {
  const field = problem.pointer?.slice(1);
  const label = field === undefined ? undefined : labels[field];

  return problem.problem === "layout.value" && label !== undefined
    ? m.refused_value({ field: label })
    : undefined;
}
