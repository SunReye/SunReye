// The builder's live checks before saving (ADR 20), worded: a module the core would refuse, and a
// string whose open-circuit voltage at −10 °C, as the pv crate reckons it, exceeds its inverter's
// maximum DC input voltage. That one warns, never refuses: the plant may already exist. And after a
// save, where the core points its refusal (ADR 9), worded beside the object it names.
import type { Capabilities, ModuleType, Problem } from "../api/core.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { painted, type Draft } from "./modules.ts";
import type { Misplaced, Pv } from "./pv.ts";
import type { InputLimits, Inverters, Sizing } from "./sizing.ts";

export type { Inverters } from "./sizing.ts";

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

/** The inputs the core's capabilities list, where an inverter's profile gives them (ADR 9). */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the API's generated type, read only.
export function inputsOf({ devices }: Pick<Capabilities, "devices">): Inverters {
  return Object.fromEntries(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read only, as above.
    Object.entries(devices).flatMap(([id, { inputs }]): [number, readonly InputLimits[]][] =>
      inputs === undefined || inputs.length === 0 ? [] : [[Number(id), inputs]],
    ),
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

/** An MPPT window warning (ADR 20), worded: a string's by its position, or an input's. */
export interface Sized {
  readonly string?: number;
  readonly device?: number;
  readonly input?: number;
  readonly text: string;
}

/** One warning's text; a string's names it. */
function sizedText(warning: Sizing, draft: Draft): string {
  if (warning.kind === "uneven") return m.sizing_uneven({ input: warning.input });

  if (warning.kind === "current") {
    const current = new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 });
    const { input, amperes, limit } = warning;

    return m.sizing_current({
      input,
      current: current.format(amperes),
      limit: current.format(limit),
    });
  }

  const string = draft.strings[warning.string];
  const name = string?.name ?? "";

  if (warning.kind === "noInput") return m.sizing_no_input({ name, input: string?.input ?? 0 });

  const figures = { name, voltage: Math.round(warning.volts), limit: Math.round(warning.limit) };
  const texts = { start: m.sizing_start, low: m.sizing_low, high: m.sizing_high };

  return texts[warning.kind](figures);
}

/** The draft's MPPT window warnings as the crate reckons them, its modules counted from the
 * scene; none while no inverter lists its inputs. */
export function sized(
  pv: Readonly<Pick<Pv, "sizing">>,
  draft: Draft,
  moduleTypes: readonly Readonly<ModuleType>[],
  inverters: Inverters,
): Sized[] {
  if (Object.keys(inverters).length === 0) return [];

  const strings = draft.strings.map((string, i) => ({
    ...string,
    modules: painted(draft.scene, i).modules,
  }));

  return pv.sizing(moduleTypes, strings, inverters).map((warning) => {
    const text = sizedText(warning, draft);

    return "string" in warning
      ? { string: warning.string, text }
      : { device: warning.device, input: warning.input, text };
  });
}

/** What the live checks read: the crate and each inverter's limits. */
export interface Checking {
  readonly pv: Readonly<Pick<Pv, "coldVoltages" | "sizing">>;
  readonly limits: Limits;
  readonly inputs: Inverters;
}

/** The draft's warnings: its strings over their inverter's limit in the cold, and where it leaves
 * an MPPT input's window; with the inputs they were reckoned against. */
export function checked(
  { pv, limits, inputs }: Checking,
  draft: Draft,
  moduleTypes: readonly Readonly<ModuleType>[],
) {
  return {
    cold: coldStrings(pv, draft, moduleTypes, limits),
    sized: sized(pv, draft, moduleTypes, inputs),
    inputs,
  };
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
