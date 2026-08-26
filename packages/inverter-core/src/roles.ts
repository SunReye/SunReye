import type { MetricKind } from "./types";

/**
 * The closed vocabulary of canonical concepts the UI knows how to render, and
 * the shape each one expects. This is the single source of truth shared by the
 * profile SDK (authoring autocomplete + compile-time enforcement), the runtime
 * validator, and the frontend (which resolves every widget by role). Adding a
 * renderable concept means adding an entry here — nothing else references a
 * bare role string list.
 *
 * {@link CanonicalRole} is derived from this object's keys, so the two can never
 * drift. **Never rename a key**: `deriveCapabilities` matches on the literal
 * strings and `.svelte` views hard-code them.
 */
export interface RoleSpec {
  /** Advisory kind for coverage/authoring; the manifest still infers kind via `resolveKind`. */
  kind: MetricKind;
  /** Requires a 1-based `index` on the metric (PV strings, grid/load phases). */
  indexed?: boolean;
  /** A control: the mapped metric must have `access: "rw"`. */
  writable?: boolean;
  /** Enum/flag concept: the mapped metric must carry `enumLabels`. */
  needsEnumLabels?: boolean;
  /** Has a natural +/- direction (charge/discharge, import/export) — expects `flow`. */
  signed?: boolean;
  /** Conventional unit, for authoring guidance and the coverage report. */
  unitHint?: string;
}

export const ROLE_CATALOG = {
  // --- Solar ---
  "pv.string.power": { kind: "measurement", indexed: true, unitHint: "W" },
  "pv.string.voltage": { kind: "measurement", indexed: true, unitHint: "V" },
  "pv.string.current": { kind: "measurement", indexed: true, unitHint: "A" },
  "pv.total.power": { kind: "measurement", unitHint: "W" },
  "production.today": { kind: "cumulative", unitHint: "kWh" },
  "production.total": { kind: "cumulative", unitHint: "kWh" },
  // --- Battery ---
  "battery.soc": { kind: "measurement", unitHint: "%" },
  "battery.power": { kind: "measurement", signed: true, unitHint: "W" },
  "battery.voltage": { kind: "measurement", unitHint: "V" },
  "battery.current": { kind: "measurement", signed: true, unitHint: "A" },
  "battery.temperature": { kind: "measurement", unitHint: "°C" },
  // Charging-type control (read-only): lead-acid batteries are driven by target
  // voltage, lithium (BMS) by target SOC — this decides which TOU target applies.
  "battery.mode": { kind: "status", needsEnumLabels: true },
  "battery.energy.charged.today": { kind: "cumulative", unitHint: "kWh" },
  "battery.energy.charged.total": { kind: "cumulative", unitHint: "kWh" },
  "battery.energy.discharged.today": { kind: "cumulative", unitHint: "kWh" },
  "battery.energy.discharged.total": { kind: "cumulative", unitHint: "kWh" },
  // --- Grid ---
  "grid.power": { kind: "measurement", signed: true, unitHint: "W" },
  "grid.phase.voltage": { kind: "measurement", indexed: true, unitHint: "V" },
  "grid.phase.current": { kind: "measurement", indexed: true, signed: true, unitHint: "A" },
  "grid.phase.power": { kind: "measurement", indexed: true, signed: true, unitHint: "W" },
  "grid.energy.imported.today": { kind: "cumulative", unitHint: "kWh" },
  "grid.energy.imported.total": { kind: "cumulative", unitHint: "kWh" },
  "grid.energy.exported.today": { kind: "cumulative", unitHint: "kWh" },
  "grid.energy.exported.total": { kind: "cumulative", unitHint: "kWh" },
  // --- House load ---
  // Whole-house consumption, wherever it is measured: a hybrid's load output, a
  // grid-tied plant's consumption meter, or a computed residual. Never "the UPS
  // socket" — that is `backup.*` below, and conflating the two makes a
  // grid-tied inverter claim hardware it does not have.
  "load.power": { kind: "measurement", unitHint: "W" },
  "load.phase.power": { kind: "measurement", indexed: true, unitHint: "W" },
  "load.phase.voltage": { kind: "measurement", indexed: true, unitHint: "V" },
  "load.energy.today": { kind: "cumulative", unitHint: "kWh" },
  "load.energy.total": { kind: "cumulative", unitHint: "kWh" },
  // --- Backup / EPS output ---
  // The islanded output that keeps running through a grid failure, metered
  // separately from the house. On a whole-home UPS these repeat `load.*`, so a
  // profile maps them only when the two genuinely differ (a critical-loads
  // sub-panel), and states the output it does not meter via
  // `declares.backupOutput` instead.
  "backup.power": { kind: "measurement", unitHint: "W" },
  "backup.phase.power": { kind: "measurement", indexed: true, unitHint: "W" },
  "backup.phase.voltage": { kind: "measurement", indexed: true, unitHint: "V" },
  "backup.energy.today": { kind: "cumulative", unitHint: "kWh" },
  "backup.energy.total": { kind: "cumulative", unitHint: "kWh" },
  // --- Generator ---
  "generator.power": { kind: "measurement", unitHint: "W" },
  "generator.phase.power": { kind: "measurement", indexed: true, unitHint: "W" },
  "generator.phase.voltage": { kind: "measurement", indexed: true, unitHint: "V" },
  "generator.energy.today": { kind: "cumulative", unitHint: "kWh" },
  // --- Inverter ---
  "inverter.status": { kind: "status", needsEnumLabels: true },
  "inverter.relay_status": { kind: "status", needsEnumLabels: true },
  "inverter.temperature.dc": { kind: "measurement", unitHint: "°C" },
  "inverter.temperature.ac": { kind: "measurement", unitHint: "°C" },
  // Power the inverter consumes for itself (conversion losses + standby draw)
  // and the share of drawn power that reaches the load — both computed, not wired.
  "inverter.power": { kind: "measurement", unitHint: "W" },
  "inverter.efficiency": { kind: "measurement", unitHint: "%" },
  // --- Settings / controls ---
  "setting.battery.max_charge_current": { kind: "setting", writable: true, unitHint: "A" },
  "setting.battery.max_discharge_current": { kind: "setting", writable: true, unitHint: "A" },
  "setting.battery.max_grid_charge_current": { kind: "setting", writable: true, unitHint: "A" },
  "setting.battery.grid_charge": { kind: "setting", writable: true, needsEnumLabels: true },
  "setting.work_mode": { kind: "setting", writable: true, needsEnumLabels: true },
  "setting.solar_sell.max_power": { kind: "setting", writable: true, unitHint: "W" },
  "setting.solar_sell.enabled": { kind: "setting", writable: true, needsEnumLabels: true },
} as const satisfies Record<string, RoleSpec>;

/**
 * Canonical, inverter-agnostic concept a metric represents — the stable
 * vocabulary the UI renders against. Derived from {@link ROLE_CATALOG} keys.
 */
export type CanonicalRole = keyof typeof ROLE_CATALOG;

/** All role names as a runtime array (for validation / iteration). */
export const ROLE_NAMES = Object.keys(ROLE_CATALOG) as [CanonicalRole, ...CanonicalRole[]];
