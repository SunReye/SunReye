// How the SPA names a series (ADR 4, ADR 22): its role namespace as the group, the label the
// sheet's Readings give its role, and its index by name. The one source of a series' name: no
// screen shows a role's series id. A role this table lacks keeps its series id.
import { flowColour, roleFlow, type Flow } from "./energy-colours.ts";
import { m } from "./paraglide/messages.js";
import type { Locale } from "./paraglide/runtime.js";
import type { SeriesMeta } from "./range/bands.ts";
import { WEATHER_CODES } from "./weather-code.ts";

/** What an index counts, which names it: an MPPT input, a string, a phase, a measurement point. */
type Family = "input" | "string" | "phase" | "point";

const INDEX: Readonly<Record<Family, (n: number) => string>> = {
  input: (n) => m.rd_input({ n }),
  string: (n) => m.explore_string({ n }),
  phase: (n) => `L${n}`,
  point: (n) => m.explore_point({ n }),
};

const FAMILIES: readonly Family[] = ["input", "string", "phase", "point"];

/** A role's label in the locale in use, or in `locale`. */
type Label = (
  inputs?: Readonly<Record<string, never>>,
  options?: Readonly<{ locale?: Locale }>,
) => string;

/** Every role in the order a group lists it, with its label and what its index counts. */
const ROLES: readonly (readonly [string, Label, Family?])[] = [
  ["pv.power", m.rd_power],
  ["pv.energy.total", m.rd_pv_total],
  ["pv.mppt.power", m.rd_power, "input"],
  ["pv.mppt.voltage", m.rd_voltage, "input"],
  ["pv.mppt.current", m.rd_current, "input"],
  ["pv.string.power", m.rd_power, "string"],
  ["battery.soc", m.rd_soc],
  ["battery.power", m.rd_power],
  ["battery.charge.power", m.explore_charge_power],
  ["battery.discharge.power", m.explore_discharge_power],
  ["battery.voltage", m.rd_voltage],
  ["battery.current", m.rd_current],
  ["battery.temperature", m.rd_temperature],
  ["battery.capacity", m.rd_capacity],
  ["battery.mode", m.explore_mode],
  ["battery.energy.charged.total", m.rd_charged_total],
  ["battery.energy.discharged.total", m.rd_discharged_total],
  ["battery.cycles", m.rd_cycles],
  ["grid.power", m.rd_power],
  ["grid.import.power", m.flow_import],
  ["grid.export.power", m.flow_export],
  ["grid.frequency", m.rd_frequency],
  ["grid.energy.imported.total", m.rd_imported_total],
  ["grid.energy.exported.total", m.rd_exported_total],
  ["grid.phase.voltage", m.rd_voltage, "phase"],
  ["grid.phase.current", m.rd_current, "phase"],
  ["grid.phase.power", m.rd_power, "phase"],
  ["load.power", m.rd_power],
  ["load.energy.total", m.rd_load_total],
  ["load.phase.power", m.rd_power, "phase"],
  ["point.power", m.rd_power, "point"],
  ["self.consumption.power", m.dash_self_use],
  ["self.supply.power", m.explore_self_supply],
  ["inverter.power", m.rd_power],
  ["inverter.loss.power", m.rd_own_use],
  ["inverter.efficiency", m.rd_efficiency],
  ["inverter.temperature", m.rd_temperature],
  ["inverter.status", m.rd_status],
  ["backup.power", m.rd_power],
  ["backup.energy.total", m.rd_load_total],
  ["generator.power", m.rd_power],
  ["generator.energy.total", m.rd_generator_total],
  ["ev.charge.power", m.explore_charge_power],
  ["ev.vehicle.soc", m.rd_ev_soc],
  ["ev.limit.soc", m.rd_ev_limit],
  ["ev.session.energy", m.rd_session_energy],
  ["ev.connected", m.rd_ev_state],
  ["ev.charging", m.rd_ev_charging],
  ["ev.mode", m.rd_ev_mode],
  ["ev.battery.boost", m.rd_boost],
  ["weather.ghi", m.explore_ghi],
  ["weather.dni", m.explore_dni],
  ["weather.dhi", m.explore_dhi],
  ["weather.temperature", m.rd_temperature],
  ["weather.wind", m.explore_wind],
  ["weather.code", m.weather_code],
  ["weather.precipitation", m.weather_precipitation],
  ["weather.snowfall", m.weather_snowfall],
  ["weather.visibility", m.weather_visibility],
  ["weather.humidity", m.weather_humidity],
  ["weather.wind_direction", m.weather_wind_direction],
  ["weather.gusts", m.weather_gusts],
  ["weather.apparent_temperature", m.weather_apparent_temperature],
  ["weather.sunshine", m.weather_sunshine_duration],
  ["weather.cloud_cover", m.weather_cloud_cover],
  ["weather.snow_depth", m.weather_snow_depth],
  ["weather.clearness", m.weather_clear_sky_index],
  ["price.import", m.explore_price_import],
  ["price.export", m.explore_price_export],
  ["price.spot", m.dash_spot],
  ["cost.import.rate", m.explore_cost_import],
  ["cost.export.rate", m.explore_cost_export],
  ["cost.savings.rate", m.explore_cost_savings],
];

const ORDER = new Map(ROLES.map(([role], i) => [role, i]));
const BY_ROLE = new Map(ROLES.map(([role, label, family]) => [role, { label, family }]));

/** The role namespaces in the picker's order, each with its group's title. */
const NAMESPACES: readonly (readonly [string, () => string])[] = [
  ["pv", m.role_pv],
  ["battery", m.role_battery],
  ["grid", m.detail_grid],
  ["load", m.role_load],
  ["point", m.rd_consumers],
  ["self", m.explore_ns_self],
  ["inverter", m.detail_inverter],
  ["backup", m.explore_ns_backup],
  ["generator", m.role_generator],
  ["ev", m.role_ev],
  ["weather", m.dash_weather],
  ["price", m.explore_ns_price],
  ["cost", m.explore_ns_cost],
];

/** Extras (ADR 4) have no role: one group, last. */
export const EXTRA = "extra";

const INDEXED = /^(?<role>.+)\[(?<index>\d+)\]$/u;

export interface Described {
  /** The role namespace, `pv`; `extra` for an extra. */
  readonly namespace: string;
  /** The name within its group: "Eingang 2 · Leistung", an extra's declared name. */
  readonly label: string;
  /** Where it stands in its group: scalars by role, then each index family by index and role. */
  readonly order: readonly number[];
}

/** A series' role, its index left out. */
export const seriesRole = (series: string): string =>
  INDEXED.exec(series)?.groups?.["role"] ?? series;

/** A role's label within its group, its index left out: "Spannung". */
export function roleLabel(role: string, locale?: Locale): string {
  return BY_ROLE.get(role)?.label({}, locale && { locale }) ?? role;
}

/** A series id as its namespace, label and place. */
export function describe(series: string): Described {
  const namespace = series.split(".", 1)[0]!;

  if (namespace === EXTRA) {
    return { namespace, label: series.slice(EXTRA.length + 1), order: [0, 0, 0, 0] };
  }

  const indexed = INDEXED.exec(series)?.groups;
  const role = indexed?.["role"] ?? series;
  const known = BY_ROLE.get(role);
  const at = ORDER.get(role) ?? ROLES.length;

  if (known === undefined) return { namespace, label: series, order: [2, 0, 0, at] };

  if (indexed === undefined || known.family === undefined) {
    return { namespace, label: known.label(), order: [0, 0, 0, at] };
  }

  const index = Number(indexed["index"]);

  return {
    namespace,
    label: `${INDEX[known.family](index)} · ${known.label()}`,
    order: [1, FAMILIES.indexOf(known.family), index, at],
  };
}

/** What a series' index counts, by name: "Eingang 2"; null for a series or a role without one. */
export function indexName(series: string): string | null {
  const indexed = INDEXED.exec(series)?.groups;
  const family = BY_ROLE.get(indexed?.["role"] ?? "")?.family;

  return indexed === undefined || family === undefined
    ? null
    : INDEX[family](Number(indexed["index"]));
}

/** A namespace's place among the groups; an unknown one after the known, extras last. */
export function namespaceOrder(namespace: string): number {
  if (namespace === EXTRA) return NAMESPACES.length + 1;

  const at = NAMESPACES.findIndex(([id]) => id === namespace);

  return at < 0 ? NAMESPACES.length : at;
}

/** A group's title; an unknown namespace keeps its own name. */
export function namespaceTitle(namespace: string): string {
  if (namespace === EXTRA) return m.explore_extras();

  return NAMESPACES.find(([id]) => id === namespace)?.[1]() ?? namespace;
}

/** A series named on its own, outside its group: "Batterie · Leistung"; an extra's declared name. */
export function seriesName(series: string): string {
  const { namespace, label } = describe(series);

  return namespace === EXTRA ? label : `${namespaceTitle(namespace)} · ${label}`;
}

/** Each status role's states by value (ADR 4). */
const STATES = new Map<string, ReadonlyMap<number, () => string>>([
  [
    "inverter.status",
    new Map([
      [0, m.rd_status_standby],
      [1, m.rd_status_normal],
      [2, m.rd_status_fault],
    ]),
  ],
  [
    "ev.mode",
    new Map([
      [0, m.rd_mode_off],
      [1, m.rd_mode_now],
      [2, m.rd_mode_minpv],
      [3, m.rd_mode_pv],
    ]),
  ],
  ["weather.code", WEATHER_CODES],
]);

/** A status value as its state's name; a value its role does not name, as the number. */
export function stateName(series: string, value: number): string {
  return STATES.get(seriesRole(series))?.get(value)?.() ?? String(value);
}

/** A signed role's two sides (ADR 4 signs): what its positive and its negative values are. */
interface Sides {
  readonly words: readonly [() => string, () => string];
  /** A side's flow colour; both sides take the role's own flow where unset. */
  readonly flows?: readonly [Flow, Flow];
}

const CHARGE: Sides = { words: [m.side_charged, m.side_discharged] };
const GRID: Sides = { words: [m.side_imported, m.side_exported], flows: ["import", "export"] };
const SIGNED: Sides = { words: [m.side_above, m.side_below] };

/** ADR 4's signed flows, by what their sign means. A price or a cost is signed but no flow: like any
 * other role it is named for itself, and above and below zero only where it went below. */
const SIDES = new Map<string, Sides>([
  ["battery.power", CHARGE],
  ["battery.current", CHARGE],
  ["grid.power", GRID],
  ["grid.phase.power", GRID],
  ["grid.phase.current", GRID],
  ["inverter.power", SIGNED],
  ["point.power", SIGNED],
]);

/** Whether a series' role is a signed flow (ADR 4), so its upper side is named for its sign. */
export const isSignedFlow = (series: string): boolean => SIDES.has(seriesRole(series));

/**
 * The upper side's key and the lower side's of a series that runs both ways, named and coloured;
 * above and below zero for a role of no sign that still went below it.
 */
export function sidesOf(series: string): readonly [SeriesMeta, SeriesMeta] {
  const sides = SIDES.get(seriesRole(series)) ?? SIGNED;
  const own = roleFlow(series);
  const [up, down] = sides.flows ?? [own, own];

  return [
    { label: sides.words[0](), colour: flowColour(up) },
    { label: sides.words[1](), colour: flowColour(down) },
  ];
}

/** A one-sided series' key: its name, in its role's flow colour. */
export function keyOf(series: string): SeriesMeta {
  return { label: seriesName(series), colour: flowColour(roleFlow(series)) };
}
