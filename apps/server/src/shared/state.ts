import type { InverterSample } from "@SunReye/inverter-core";

/**
 * Last sample read per device, shared with the HTTP layer so "current value"
 * endpoints answer from memory instead of round-tripping to TimescaleDB.
 *
 * Keyed, because one poll loop became several. A single slot shared by two loops
 * is the failure mode that looks healthy: every reader would see whichever
 * device ticked most recently, stamped with that device's time, and present it
 * as the current state of a different machine.
 */
const byDevice = new Map<string, InverterSample>();

/**
 * The device {@link liveState.latest} means. Null until the composition root
 * names one — which is every install today, where there is exactly one device
 * and nothing should have to be configured for the single-device answer to work.
 */
let defaultDeviceId: string | null = null;

export const liveState = {
  /**
   * The default device's most recent sample.
   *
   * Every caller of this was written when it could only mean one machine. So:
   * the named default when there is one, the only device that has reported when
   * there is no name and only one candidate, and otherwise `null`. Never
   * "whichever ticked last" — a plausible number from the wrong device is worse
   * than no number, because nothing downstream can tell.
   */
  get latest(): InverterSample | null {
    if (defaultDeviceId !== null) return byDevice.get(defaultDeviceId) ?? null;
    return byDevice.size === 1 ? (byDevice.values().next().value ?? null) : null;
  },
  /** One device's most recent sample, or `null` if it has never reported. */
  for(deviceId: string): InverterSample | null {
    return byDevice.get(deviceId) ?? null;
  },
  /** Store a poll, under the device that produced it. */
  set(sample: InverterSample): void {
    byDevice.set(sample.inverterId, sample);
  },
  /** Name the device {@link latest} answers for; `null` restores the inference. */
  setDefaultDevice(deviceId: string | null): void {
    defaultDeviceId = deviceId;
  },
  /**
   * Forget every cached poll. The loop only moves forward, so this is for a
   * registry rebuild that drops a device — its last reading must not outlive it
   * — and for tests that need a cache with no history.
   */
  reset(): void {
    byDevice.clear();
  },
};
