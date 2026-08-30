/**
 * THE WRITE SEAM: sample -> storage policy -> buffers, for ANY registered
 * device.
 *
 * Until this file the whole persistence path lived inside the Modbus poll loop
 * (`./runtime.ts`): one closure-local `StoragePolicy` built from the one active
 * profile, fed by the one `source.read()`, keyed by whatever `inverterId` the
 * DRIVER had stamped on the sample — which was `profile.id`. A second device
 * could not be stored at all, and a device with no registers could not be
 * stored even in principle, because there was no way in that was not a poll.
 *
 * WHAT THIS IS FOR
 *
 * #88 (EVCC pushes samples arriving over MQTT) and #172 (the optimizer records
 * the decisions it just made) need exactly this and nothing more. Neither has —
 * or wants — a poll loop: they have an instance and a set of readings, and the
 * shortest honest path from there to `metrics_raw` is
 * `writer.commit(instance, { time, metrics })`.
 *
 * WHY THE SAMPLE CARRIES NO IDENTITY
 *
 * {@link DeviceSample} has no `inverterId` field, deliberately. The identity is
 * the INSTANCE's — `devices.slug`, which `./storage-identity.ts` resolves to the
 * int2 written into every row — so there is nothing for a caller to get wrong
 * and nothing for a driver to stamp. That is the defect this closes: the sample
 * a Modbus driver produces is labelled with the id of the PROFILE describing the
 * machine, and a profile is swapped, uninstalled and re-downloaded inside the
 * five years a reading is retained.
 *
 * STATE, AND WHY IT IS PER DEVICE
 *
 * A storage policy carries a change-encoder per device, a change-log memory and
 * an optional-hardware evidence set, all of which are statements about ONE
 * machine's readings. So there is one policy per registered device, rebuilt when
 * that device's declarations change — closing the outgoing policy's open
 * intervals first, because a series row is written when its interval CLOSES and
 * dropping the policy instead loses the currently-held value of every metric.
 */

import { type DeviceInstance, type MetricKeyFacts, metricKeySpecs } from "@SunReye/inverter-core";

import { type StoragePolicy, type StorageRow, createStoragePolicy } from "./storage-policy";

/** One device's readings at one instant. Identity is the instance's, not this. */
export interface DeviceSample {
  time: string | Date;
  metrics: Record<string, number>;
}

/** Where routed rows go. Structurally a {@link HistoryBuffer}'s enqueue half. */
export interface RowSink {
  enqueue(rows: StorageRow[]): void;
}

export interface DeviceWriterDeps {
  /** The timeseries destination (`metrics_raw`). */
  series: RowSink;
  /** The configuration change-log destination (`metrics_config_log`). */
  config: RowSink;
  /**
   * Register a device's metric keys the first time its declarations are seen.
   *
   * EAGER, on the same hook and against the same list as the policy build, so
   * the ids exist before the first committed sample and the writer's own lazy
   * fallback (`./storage-identity.ts`) is only ever reached by a key this list
   * did not contain. Optional: a caller that has no dimension table (a test) is
   * not obliged to invent one.
   */
  registerMetrics?(specs: readonly MetricKeyFacts[]): void;
}

export interface DeviceWriter {
  /** Route one device's sample into the two destinations. */
  commit(device: DeviceInstance, sample: DeviceSample): void;
  /**
   * Close every registered device's open series intervals at `at`.
   *
   * The runtime calls this before a source swap and at shutdown: an interval is
   * written when it closes, so without this the currently-held value of every
   * metric of every device is lost.
   */
  close(at: Date): void;
  /**
   * Drop one device, writing out what it held open.
   *
   * For a device RETIRED under a running server: its readings up to that moment
   * are history and must be stored, and nothing after it may be keyed to it.
   */
  forget(id: string): void;
}

/**
 * Build a writer. Every field is closure-local, so a second instance shares
 * nothing — the same rule the runtime and the storage policy follow.
 */
export function createDeviceWriter(deps: DeviceWriterDeps): DeviceWriter {
  /** One policy per device id, with the instance it was built from. */
  const policies = new Map<string, { device: DeviceInstance; policy: StoragePolicy }>();

  /**
   * Write out one policy's open intervals. The rows come back already keyed by
   * the id they were routed under, which is the device's — the policy's encoder
   * map is keyed by the `inverterId` {@link DeviceWriter.commit} stamped.
   */
  function closeOne(policy: StoragePolicy, at: Date): void {
    deps.series.enqueue(policy.close(at));
  }

  function policyFor(device: DeviceInstance, at: Date): StoragePolicy {
    const held = policies.get(device.id);
    if (held?.device === device) return held.policy;
    // A different instance for the same id is a re-registration — a profile
    // swapped, a mapping edited. End the outgoing declarations' intervals under
    // the policy that opened them.
    if (held) closeOne(held.policy, at);
    const policy = createStoragePolicy({ metrics: device.metrics });
    policies.set(device.id, { device, policy });
    // `metricKeySpecs` states the key, the COUNTER CLASS and the UNIT together:
    // a continuous aggregate cannot ask a device what a metric means, so all
    // three have to travel with the key.
    deps.registerMetrics?.(metricKeySpecs(device.metrics));
    return policy;
  }

  return {
    commit(device, sample) {
      const time = sample.time instanceof Date ? sample.time : new Date(sample.time);
      // The identity is the INSTANCE's, stamped here — see the module note.
      const routed = policyFor(device, time).route({ ...sample, inverterId: device.id });
      // An empty list is a no-op in the buffer, so neither destination is guarded.
      deps.series.enqueue(routed.series);
      deps.config.enqueue(routed.config);
    },
    close(at) {
      for (const held of policies.values()) closeOne(held.policy, at);
    },
    forget(id) {
      const held = policies.get(id);
      if (!held) return;
      closeOne(held.policy, new Date());
      policies.delete(id);
    },
  };
}
