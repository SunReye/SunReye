import type { InverterSample } from "@SunReye/inverter-core";

/**
 * Last sample read by the God-loop, shared with the HTTP layer so
 * "current value" endpoints answer from memory instead of round-tripping to
 * TimescaleDB. `null` until the first successful poll.
 */
let latest: InverterSample | null = null;

export const liveState = {
  get latest(): InverterSample | null {
    return latest;
  },
  set(sample: InverterSample): void {
    latest = sample;
  },
};
