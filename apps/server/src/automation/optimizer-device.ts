/**
 * THE OPTIMIZER, AS A DEVICE — every decision it makes becomes a reading.
 *
 * WHAT THIS REPLACES
 *
 * A 2 880-slot in-memory ring (`./automation-history.ts`) and a bespoke
 * WebSocket topic. Twenty-four hours of decisions, gone on restart, addressable
 * by exactly one hand-written endpoint and chartable by exactly one hand-written
 * series builder. No rollups, no CSV export, no custom charts, no archive
 * round-trip — and the statistics layer could not answer "what did the optimizer
 * save", because statistics reads `metrics_raw` and nothing here ever wrote to
 * it. The ring's own header said the API shape existed so a persistent store
 * could be swapped in later. This is later.
 *
 * WHY A DEVICE ROW RATHER THAN A TABLE OF ITS OWN
 *
 * Because what the optimizer produces are READINGS, and every reading in this
 * system is keyed to a device. A decision table would need its own retention
 * policy, its own compression, its own rollup aggregates, its own export path
 * and its own archive entry — five things that already exist and work, for the
 * privilege of being a second shape nothing else understands. A row in `devices`
 * with `connection_id NULL` — which the column was designed for — buys all five
 * and costs one row.
 *
 * WHAT IT DELIBERATELY DOES NOT RECORD
 *
 * The plant's own measurements. `pvW`, `loadW`, `evChargeW`, `batteryV`,
 * `chargeW`, `exportW` and `socPct` all rode in the ring's decision point, and
 * every one of them is `pv.total.power` / `load.power` / `ev.charge.power` /
 * `battery.voltage` / `battery.power` / `grid.power` / `battery.soc` on the
 * device that measured it, at the poll cadence, already stored. Writing them
 * again under the optimizer would double the rows and leave two series that can
 * disagree with no rule about which one is right. The ring carried them because
 * it had no other way to draw a chart; the generic read path is the other way.
 *
 * Same for `liveA`: the register readback is the inverter's
 * `setting.battery.max_charge_current`, already logged as configuration. What
 * belongs to the OPTIMIZER is the value it wrote — `optimizer.applied.current`.
 *
 * STORAGE COST, DECIDED DELIBERATELY
 *
 * Decisions are 30 s. Nothing here is stored at 30 s: every series metric is
 * change-encoded by the same policy every Modbus metric goes through, so a
 * steady ceiling on a flat afternoon writes ONE row with a growing `dur_ms`, and
 * the continuous outputs carry a deadband in their own unit on top of that
 * (0.5 A on the two currents, 25 W on the three powers, 0.05 kWh on the
 * energies) so that register noise does not become rows. The enum and boolean
 * outputs carry no deadband at all — `resolveDeadband` refuses one for a
 * `status` kind precisely so a state transition can never be swallowed — and
 * they change a handful of times a day anyway.
 *
 * The three that are the OPERATOR'S configuration rather than the optimizer's
 * conclusion (`enabled`, `mode`, `restore.pending`) go to the config change-log
 * instead: one row when they actually change. A mode nobody touched for a month
 * is one row, not 86 400.
 */

import type { PeakShavingMode, PeakShavingStatus } from "@SunReye/contracts/automation";
import type { DeviceMetric } from "@SunReye/inverter-core";

import type { DeviceSample } from "../inverter/device-writer";

/**
 * The `integration` string the optimizer's device carries. PROVENANCE ONLY: a
 * consumer that branches on it is the acceptance failure #78 is written against.
 */
export const OPTIMIZER_INTEGRATION = "optimizer";

/**
 * The `profile_id` the optimizer's `devices` row names.
 *
 * `devices.profile_id` carries no foreign key (#169) and the optimizer has no
 * register map to install, so this is a NAME the registry resolves through its
 * coded-declaration table (`../devices/coded.ts`) rather than through the
 * profile store. Namespaced so no profile can ever collide with it.
 */
export const OPTIMIZER_PROFILE = "sunreye.optimizer";

/**
 * `devices.slug` — the identity every decision is keyed under, frozen once
 * written. There is exactly ONE optimizer per plant: it steers the plant, not a
 * machine, so nothing about it is indexed.
 */
export const OPTIMIZER_DEVICE_ID = "optimizer";

/**
 * The run states, as the integers stored under `optimizer.state`.
 *
 * FROZEN BY POSITION. `metrics_raw` holds an int for five years and this array
 * is the only thing that can say what it meant; reordering it silently re-labels
 * every row ever written. Append at the end, never insert, never reorder — the
 * same rule an enum column in any database follows.
 */
// fallow-ignore-next-line unused-export -- the frozen vocabulary is what optimizer-device.test.ts asserts; test files aren't traced as consumers
export const OPTIMIZER_RUN_STATES = [
  "disabled",
  "blocked",
  "idle",
  "active",
  "shadow",
  "simulating",
  "stale",
] as const;

/** The price regimes, as the integers stored under `optimizer.price.regime`. Frozen by position. */
// fallow-ignore-next-line unused-export -- as above: the ordering IS the contract, and only its test names it
export const OPTIMIZER_PRICE_REGIMES = [
  "none",
  "waiting",
  "pre-shape",
  "spend-down",
  "absorb",
] as const;

/** The modes, as the integers stored under `optimizer.mode`. Frozen by position. */
// fallow-ignore-next-line unused-export -- as above
export const OPTIMIZER_MODES = ["maximize-exports", "grid-friendly"] as const;

/** A decision output: read-only, keyed by its own role, in the optimizer's group. */
function decided(
  key: string,
  unit: string | null,
  extra: Partial<DeviceMetric> = {},
): DeviceMetric {
  return { key, unit, group: "optimizer", access: "r", role: key as never, ...extra };
}

/**
 * What the optimizer declares it produces.
 *
 * The key IS the role, as it is for every coded device: there is no vendor
 * register name to preserve, and `metric_keys` is plant-wide.
 */
export const OPTIMIZER_METRICS: readonly DeviceMetric[] = [
  // --- the decision ---
  decided("optimizer.target.current", "A", { deadband: 0.5 }),
  decided("optimizer.applied.current", "A", { deadband: 0.5 }),
  decided("optimizer.threshold.power", "W", { deadband: 25 }),
  decided("optimizer.sell.limit.power", "W", { deadband: 25 }),
  decided("optimizer.grid.charge.current", "A", { deadband: 0.5 }),
  // --- the reasoning behind it ---
  decided("optimizer.excess.power", "W", { deadband: 25 }),
  decided("optimizer.local.sink.power", "W", { deadband: 25 }),
  decided("optimizer.headroom.energy", "kWh", { deadband: 0.05 }),
  decided("optimizer.surplus.energy", "kWh", { deadband: 0.05 }),
  decided("optimizer.soc.envelope", "%", { deadband: 0.5 }),
  decided("optimizer.soakable.energy", "kWh", { deadband: 0.05 }),
  decided("optimizer.unavoidable.energy", "kWh", { deadband: 0.05 }),
  decided("optimizer.ev.demand.energy", "kWh", { deadband: 0.05 }),
  // --- what the tick concluded about itself; no deadband, by kind ---
  decided("optimizer.state", null, { kind: "status" }),
  decided("optimizer.price.regime", null, { kind: "status" }),
  decided("optimizer.override", null, { kind: "status" }),
  decided("optimizer.ineffective", null, { kind: "status" }),
  // --- the operator's configuration: a change-log, not a series ---
  decided("optimizer.enabled", null, { kind: "setting" }),
  decided("optimizer.mode", null, { kind: "setting" }),
  // A held snapshot is a fact about state, not a setting — but it changes twice
  // a day at most, so it is stated as configuration rather than derived as one.
  decided("optimizer.restore.pending", null, { kind: "status", storage: "config" }),
];

/**
 * The `devices` row the optimizer needs, so its decisions have an identity to be
 * keyed under.
 *
 * `connectionId: null` and `unitId: 0`: there is no endpoint, no register and no
 * unit on a bus. `role: "optimizer"` is what keeps it out of every plant sum —
 * `physicalDevices` filters it from provisioning, the MQTT namespace and the
 * device pickers, and it declares no production, consumption or battery role, so
 * nothing that sums the plant can reach it even by accident.
 *
 * Pure, and separate from the insert, so the shape is provable without a
 * database while the composition root keeps the plumbing.
 */
export function optimizerDeviceSpec(plantId: number): {
  plantId: number;
  connectionId: null;
  unitId: number;
  slug: string;
  name: string;
  profileId: string;
  role: string;
} {
  return {
    plantId,
    connectionId: null,
    unitId: 0,
    slug: OPTIMIZER_DEVICE_ID,
    // A CREATION default the operator may then edit — `ensureDevice` never
    // overwrites an existing name.
    name: "Optimizer",
    profileId: OPTIMIZER_PROFILE,
    role: "optimizer",
  };
}

/** Where a frozen vocabulary places a value; -1 becomes an omission, not a lie. */
function ordinal(vocabulary: readonly string[], value: string): number | null {
  const at = vocabulary.indexOf(value);
  return at === -1 ? null : at;
}

/** Set `key` only when there is a value — absent is absent, and `0` is a value. */
function put(metrics: Record<string, number>, key: string, value: number | null): void {
  if (value !== null) metrics[key] = value;
}

/**
 * One tick's decision, as one sample of optimizer readings.
 *
 * ABSENT IS ABSENT. A null envelope is "not pre-shaping", a null grid-charge
 * current is "not grid-charging" and a null `lastWrittenA` is "nothing has been
 * written yet"; a `0` for any of them would be a decision the optimizer never
 * made. The write path already drops non-finite values, and a key simply left
 * out closes its interval and leaves a gap — which is the truth. A measured
 * zero, by contrast, is kept: an excess of 0 W is a fact about now.
 *
 * `localSinkW` is the one number the status does not carry, so the caller hands
 * it in from the decision it just made.
 */
export function optimizerSample(
  status: PeakShavingStatus,
  localSinkW: number,
  at: Date,
): DeviceSample {
  const metrics: Record<string, number> = {
    "optimizer.enabled": status.enabled ? 1 : 0,
    "optimizer.override": status.externalOverride ? 1 : 0,
    "optimizer.ineffective": status.ineffective ? 1 : 0,
    "optimizer.restore.pending": status.restorePending ? 1 : 0,
    "optimizer.local.sink.power": localSinkW,
  };
  put(metrics, "optimizer.state", ordinal(OPTIMIZER_RUN_STATES, status.state));
  put(metrics, "optimizer.mode", ordinal(OPTIMIZER_MODES, status.mode as PeakShavingMode));
  put(metrics, "optimizer.price.regime", ordinal(OPTIMIZER_PRICE_REGIMES, status.priceRegime));
  put(metrics, "optimizer.target.current", status.targetA);
  put(metrics, "optimizer.applied.current", status.lastWrittenA);
  put(metrics, "optimizer.threshold.power", status.thresholdW);
  put(metrics, "optimizer.sell.limit.power", status.sellLimitW);
  put(metrics, "optimizer.grid.charge.current", status.gridChargeA);
  put(metrics, "optimizer.excess.power", status.liveExcessW);
  put(metrics, "optimizer.headroom.energy", status.headroomKwh);
  put(metrics, "optimizer.surplus.energy", status.remainingAboveLimitKwh);
  put(metrics, "optimizer.soc.envelope", status.socEnvelopePct);
  put(metrics, "optimizer.soakable.energy", status.soakableKwh);
  put(metrics, "optimizer.unavoidable.energy", status.unavoidableZeroValueKwh);
  put(metrics, "optimizer.ev.demand.energy", status.evDemandKwh);
  return { time: at, metrics };
}
