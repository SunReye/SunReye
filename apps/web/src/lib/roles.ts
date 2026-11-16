// How the SPA names a series (ADR 4, ADR 22): its role namespace as the group, the label the
// sheet's Readings give its role, and its index by name. The one source of a series' name: no
// screen shows a role's series id. A role this table lacks keeps its series id.
import { m } from "./paraglide/messages.js";

/** What an index counts, which names it: an MPPT input, a string, a phase, a measurement point. */
type Family = "input" | "string" | "phase" | "point";

const INDEX: Readonly<Record<Family, (n: number) => string>> = {
  input: (n) => m.rd_input({ n }),
  string: (n) => m.explore_string({ n }),
  phase: (n) => `L${n}`,
  point: (n) => m.explore_point({ n }),
};

const FAMILIES: readonly Family[] = ["input", "string", "phase", "point"];

/** Every role in the order a group lists it, with its label and what its index counts. */
export const ROLES: readonly (readonly [string, () => string, Family?])[] = [
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
  ["ev.connected", m.rd_ev_plugged],
  ["ev.charging", m.rd_ev_charging],
  ["ev.mode", m.rd_ev_mode],
  ["ev.battery.boost", m.rd_boost],
  ["weather.ghi", m.explore_ghi],
  ["weather.dni", m.explore_dni],
  ["weather.dhi", m.explore_dhi],
  ["weather.temperature", m.rd_temperature],
  ["weather.wind", m.explore_wind],
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
