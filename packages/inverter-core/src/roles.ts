import type { DeviceClass } from "./device-instance";
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
  /**
   * The device class this concept describes, when it is not the inverter a
   * register profile maps. Absent means `inverter` — the overwhelming majority,
   * and the only class a register profile can describe at all.
   *
   * Read by the profile SDK's coverage report, which asks "which renderable
   * areas does THIS PROFILE leave empty": a loadpoint's roles are not an area a
   * hybrid inverter's author has forgotten, and reporting them would ask every
   * author to map registers their machine does not have.
   */
  deviceClass?: DeviceClass;
}

export const ROLE_CATALOG = {
  // --- Solar ---
  "pv.string.power": { kind: "measurement", indexed: true, unitHint: "W" },
  "pv.string.voltage": { kind: "measurement", indexed: true, unitHint: "V" },
  "pv.string.current": { kind: "measurement", indexed: true, unitHint: "A" },
  "pv.total.power": { kind: "measurement", unitHint: "W" },
  // Per-string yield, for the inverters that count each MPPT separately (4-input
  // hybrids, and every string inverter with per-tracker energy registers).
  "pv.string.energy.today": { kind: "cumulative", indexed: true, unitHint: "kWh" },
  "pv.string.energy.total": { kind: "cumulative", indexed: true, unitHint: "kWh" },
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
  // Reported by essentially every grid-tied device (SunSpec, Sungrow, Victron)
  // and the first thing an installer looks at on an islanding fault.
  "grid.frequency": { kind: "measurement", unitHint: "Hz" },
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
  // --- EV charging ---
  // One loadpoint — one place a car plugs in — regardless of who reports it: an
  // EVCC instance, a wallbox on Modbus, a user's Home Assistant mapping. These
  // are the values that are the SAME question for all of them, and therefore the
  // only ones that belong in the contract.
  //
  // What is deliberately NOT here: the three-layer charge limit (a durable
  // per-vehicle `limitSoc`, a per-session loadpoint override and EVCC's own
  // resolution of the two, where `0` means "no override" and not "no limit"),
  // the battery-boost contract, and the feed-forward power estimator. Those are
  // one integration's semantics, validated against one live instance, and a role
  // that flattened them would be a role every other integration would have to
  // fake. An integration may expose MORE than the contract; it may never expose
  // less — so they stay on EVCC's own surface.
  "ev.charge.power": { kind: "measurement", unitHint: "W", deviceClass: "charger" },
  /** State of charge of the car currently plugged in — not the house battery. */
  "ev.vehicle.soc": { kind: "measurement", unitHint: "%", deviceClass: "charger" },
  /**
   * Energy delivered in the current charging session. A counter that RESETS to
   * zero on every plug-in, which is the same shape the daily `*.today` totals
   * already have.
   */
  "ev.session.energy": { kind: "cumulative", unitHint: "kWh", deviceClass: "charger" },
  /** A car is plugged in (1/0). No `needsEnumLabels`: a boolean is not an enum. */
  "ev.connected": { kind: "status", deviceClass: "charger" },
  /** Current is actually flowing into the car (1/0). */
  "ev.charging": { kind: "status", deviceClass: "charger" },
  // --- Optimizer ---
  // What the peak-shaving optimizer DECIDED, as opposed to what the plant
  // measured. A decision is a reading about the automation, keyed to a device
  // like every other reading — which is what makes it rollupable, exportable,
  // chartable and archivable, and what the 2 880-slot in-memory ring could
  // never be.
  //
  // What is deliberately NOT here: `pv.total.power`, `load.power`,
  // `battery.power`, `grid.power`, `battery.soc` and the live register readback.
  // Every one of those is a MEASUREMENT that already has a device and a series
  // of its own, and re-recording them under the optimizer would be two rows
  // saying the same thing with no rule about which one wins. The decision log's
  // ring carried them because it had no other way to draw a chart; the generic
  // read path does.
  /** Charge-current ceiling the tick landed on, A — the headline decision. */
  "optimizer.target.current": { kind: "measurement", unitHint: "A", deviceClass: "optimizer" },
  /**
   * The value most recently WRITTEN to the register, A — the audit trail of the
   * automation's own hand on the plant, and the one series that answers "what
   * did we actually do" after the fact.
   */
  "optimizer.applied.current": { kind: "measurement", unitHint: "A", deviceClass: "optimizer" },
  /** The shave threshold held this tick, W — the plateau the ceiling chart draws. */
  "optimizer.threshold.power": { kind: "measurement", unitHint: "W", deviceClass: "optimizer" },
  /** PV above the threshold the decision had to place somewhere, W. */
  "optimizer.excess.power": { kind: "measurement", unitHint: "W", deviceClass: "optimizer" },
  /** PV that can never reach the grid (house load, plus the EV when separate), W. */
  "optimizer.local.sink.power": { kind: "measurement", unitHint: "W", deviceClass: "optimizer" },
  /** Battery room the decision believed it had, kWh. */
  "optimizer.headroom.energy": { kind: "measurement", unitHint: "kWh", deviceClass: "optimizer" },
  /** Forecast energy still to come above the export limit, kWh. */
  "optimizer.surplus.energy": { kind: "measurement", unitHint: "kWh", deviceClass: "optimizer" },
  /** SOC bound the pre-window envelope allows now, % — absent when not shaping. */
  "optimizer.soc.envelope": { kind: "measurement", unitHint: "%", deviceClass: "optimizer" },
  /** Energy a negative-price window can push into the pack, kWh. */
  "optimizer.soakable.energy": { kind: "measurement", unitHint: "kWh", deviceClass: "optimizer" },
  /** Window energy that will earn nothing whatever the pack does, kWh. */
  "optimizer.unavoidable.energy": {
    kind: "measurement",
    unitHint: "kWh",
    deviceClass: "optimizer",
  },
  /** Remaining EV charge demand the surplus was reduced by, kWh. */
  "optimizer.ev.demand.energy": { kind: "measurement", unitHint: "kWh", deviceClass: "optimizer" },
  /** Feed-in ceiling written to the solar-sell register, W — `grid-friendly` only. */
  "optimizer.sell.limit.power": { kind: "measurement", unitHint: "W", deviceClass: "optimizer" },
  /** Grid-charge current commanded for a window, A. */
  "optimizer.grid.charge.current": {
    kind: "measurement",
    unitHint: "A",
    deviceClass: "optimizer",
  },
  /** Which run state the tick was in (see `OPTIMIZER_RUN_STATES`). */
  "optimizer.state": { kind: "status", needsEnumLabels: true, deviceClass: "optimizer" },
  /** What price awareness was doing (see `OPTIMIZER_PRICE_REGIMES`). */
  "optimizer.price.regime": { kind: "status", needsEnumLabels: true, deviceClass: "optimizer" },
  /** The register drifted from our last write (1/0) — a CONCLUSION, not a setting. */
  "optimizer.override": { kind: "status", deviceClass: "optimizer" },
  /** The ceiling moved and the battery did not follow (1/0). */
  "optimizer.ineffective": { kind: "status", deviceClass: "optimizer" },
  /** The operator's master switch, as the optimizer resolved it (1/0). */
  "optimizer.enabled": { kind: "setting", deviceClass: "optimizer" },
  /** Which mode it is steering in (see `OPTIMIZER_MODES`). */
  "optimizer.mode": { kind: "setting", needsEnumLabels: true, deviceClass: "optimizer" },
  /** A user register value is held and owed back (1/0). Changes rarely. */
  "optimizer.restore.pending": { kind: "status", deviceClass: "optimizer" },
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
  // Battery limits come in two denominations and a profile maps whichever its
  // device actually exposes: a current ceiling (Deye/Sunsynk and most
  // high-voltage hybrids) or a power ceiling (Victron ESS, SMA, and every device
  // whose limits are set in watts). Never both for the same limit — the pair
  // would give the automation two registers to steer for one quantity.
  "setting.battery.max_charge_current": { kind: "setting", writable: true, unitHint: "A" },
  "setting.battery.max_discharge_current": { kind: "setting", writable: true, unitHint: "A" },
  "setting.battery.max_grid_charge_current": { kind: "setting", writable: true, unitHint: "A" },
  "setting.battery.max_charge_power": { kind: "setting", writable: true, unitHint: "W" },
  "setting.battery.max_discharge_power": { kind: "setting", writable: true, unitHint: "W" },
  "setting.battery.max_grid_charge_power": { kind: "setting", writable: true, unitHint: "W" },
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
