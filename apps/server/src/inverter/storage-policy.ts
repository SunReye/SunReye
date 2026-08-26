/**
 * Where each metric of a poll goes — the one place the profile's storage class
 * is turned into rows, peeled out of the runtime so it can be tested without a
 * poll loop, a transport or a database.
 *
 * Two things happen here, and both are *persistence* decisions only. The live
 * WebSocket frame, the MQTT bridge and the peak-shaving engine all read the
 * sample itself, so nothing below can change what the app does — only what it
 * keeps:
 *
 * 1. **Config registers leave the hypertable.** 37 of one measured profile's 108
 *    metrics are configuration (30 x `timeofuse.*`, 7 x `settings.*`), rewritten
 *    into a timeseries table every poll: 34 % of every row, carrying no
 *    information. They land in a change-log instead — one row when the value
 *    actually changes. Which metrics those are is asked of the profile
 *    (`resolveStorage`), never matched by key prefix: `timeofuse.*` is one
 *    vendor's naming, and a prefix list silently stops applying on the next one.
 * 2. **Absent hardware is not persisted.** Five generator metrics read a
 *    constant 0 because no generator is connected — 7,194 rows each per 6 h for
 *    hardware that is not there. `deriveCapabilities` cannot answer this: the
 *    profile *does* map generator roles, so role presence says the subsystem
 *    exists. Only the readings say otherwise, so the evidence is runtime.
 */

import { resolveStorage } from "@SunReye/inverter-core";
import type { MetricDef, MetricStorage } from "@SunReye/inverter-core";

/** One row of either destination: they share a shape, not a table. */
export interface StorageRow {
  time: Date;
  inverterId: string;
  metric: string;
  value: number;
}

/** Where one poll's readings are to be written. */
export interface RoutedSample {
  /** Timeseries rows, for `metrics_raw`. */
  series: StorageRow[];
  /** Config change-log rows — only values that actually changed. */
  config: StorageRow[];
}

/** The sample shape the poll loop produces (a subset of `InverterSample`). */
export interface RoutableSample {
  time: string | Date;
  inverterId: string;
  metrics: Record<string, number>;
}

/**
 * Role prefixes for subsystems that may simply not be wired up, and whose
 * absence is indistinguishable from idleness *except* by never having answered.
 *
 * Deliberately short. A PV string reads 0 every night and a battery at rest
 * reads 0 W, so suppressing those would make "measured zero" and "not recorded"
 * indistinguishable in the history — the conflation the decode layer refuses one
 * level down, and the boundary the frontend carry-forward work has to keep. A
 * generator is different in kind: the registers exist on every model of the
 * inverter whether or not anything is plugged into them.
 */
const DEFAULT_OPTIONAL_ROLES: readonly string[] = ["generator."];

export interface StoragePolicyDeps {
  /** The active profile's metrics — the source of every storage class. */
  metrics: MetricDef[];
  /** Overrides {@link DEFAULT_OPTIONAL_ROLES}. */
  optionalRoles?: readonly string[];
}

export interface StoragePolicy {
  /** Split one sample into the rows each destination should receive. */
  route(sample: RoutableSample): RoutedSample;
}

/** Where one reading goes; `drop` is "persisted nowhere", not an error. */
type Destination = "series" | "config" | "drop";

/** `inverterId` + metric key: the identity a last-value memory is keyed by. */
const idOf = (inverterId: string, metric: string): string => `${inverterId} ${metric}`;

/**
 * Build the policy for one profile. Storage classes are resolved once per
 * profile rather than per poll; the change-log's last-value memory and the
 * hardware-evidence set are closure-local, so a second instance shares nothing
 * and a profile swap is a new policy.
 */
export function createStoragePolicy(deps: StoragePolicyDeps): StoragePolicy {
  const optionalRoles = deps.optionalRoles ?? DEFAULT_OPTIONAL_ROLES;
  const storage = new Map<string, MetricStorage>();
  /** Metric key -> the optional-hardware group it belongs to, when it has one. */
  const group = new Map<string, string>();

  for (const def of deps.metrics) {
    storage.set(def.key, resolveStorage(def));
    const role = def.role;
    const optional = role && optionalRoles.find((prefix) => role.startsWith(prefix));
    if (optional) group.set(def.key, optional);
  }

  /** Optional-hardware groups that have answered with something other than 0. */
  const present = new Set<string>();
  /** Last value written to the change-log, per inverter and metric. */
  const lastLogged = new Map<string, number>();

  /**
   * Record every optional subsystem this sample proves exists. Run over the whole
   * sample before any row is emitted, so one metric proving the hardware is there
   * admits every metric of it *including the zeros alongside it*: a generator's
   * energy counter moves while its phase power reads 0 between bursts, and that
   * is still proof it is wired up.
   */
  function noteEvidence(readings: [string, number][]): void {
    for (const [key, value] of readings) {
      const g = group.get(key);
      if (g !== undefined && value !== 0) present.add(g);
    }
  }

  /**
   * Whether the subsystem a metric belongs to has answered. True for everything
   * that is not optional hardware — most metrics have nothing to prove.
   */
  function hardwarePresent(metric: string): boolean {
    const g = group.get(metric);
    return g === undefined || present.has(g);
  }

  /**
   * Whether this value is a *change* worth a change-log row, remembering it when
   * it is. A first observation is a change (nothing was known before it) and so
   * is a return to an earlier value: the log is a history, not a set.
   */
  function admitConfigChange(inverterId: string, metric: string, value: number): boolean {
    const id = idOf(inverterId, metric);
    if (lastLogged.get(id) === value) return false;
    lastLogged.set(id, value);
    return true;
  }

  /** Which list a reading belongs in, `drop` meaning it is not persisted. */
  function destinationOf(inverterId: string, metric: string, value: number): Destination {
    // An unknown key means the profile does not describe this metric. Store it:
    // failing toward keeping data shows the gap, silently dropping it hides one.
    const where = storage.get(metric) ?? "series";
    if (where === "none") return "drop";
    if (where === "config") {
      return admitConfigChange(inverterId, metric, value) ? "config" : "drop";
    }
    return hardwarePresent(metric) ? "series" : "drop";
  }

  function route(sample: RoutableSample): RoutedSample {
    const time = sample.time instanceof Date ? sample.time : new Date(sample.time);
    // A reading that never arrived is not a value. `decode()` refuses to
    // fabricate a 0 for it upstream; persisting a NaN here would be the same
    // mistake with a different spelling.
    const readings = Object.entries(sample.metrics).filter(([, v]) => Number.isFinite(v));
    noteEvidence(readings);

    const series: StorageRow[] = [];
    const config: StorageRow[] = [];
    for (const [metric, value] of readings) {
      const destination = destinationOf(sample.inverterId, metric, value);
      if (destination === "drop") continue;
      const row = { time, inverterId: sample.inverterId, metric, value };
      (destination === "series" ? series : config).push(row);
    }
    return { series, config };
  }

  return { route };
}
