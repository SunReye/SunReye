import type { Reading } from "$lib/live/plant";

/**
 * Battery headroom (kWh) from the pack size the engine reported and the SOC the
 * meter reads.
 *
 * Two owners meet here, and that is fine: this is a *computation* over both,
 * not a choice between them. What is no longer allowed is the old fallback —
 * when SOC was absent the panel showed `status.headroomKwh`, a number the
 * engine had produced at the control interval, in a tile the reader takes for
 * live. Absent SOC now means an absent tile.
 *
 * The result is exactly as fresh as the SOC it came from: a derived number
 * cannot be newer than its input.
 */
export function headroomReading(usableKwh: number | null | undefined, soc: Reading): Reading {
  if (usableKwh == null || soc.value === undefined) return { value: undefined, stale: false };
  // A pack briefly reporting 101 % (or a momentary negative from a resetting
  // BMS) is a sensor artefact, not negative headroom.
  const pct = Math.min(100, Math.max(0, soc.value));
  return { value: (usableKwh * (100 - pct)) / 100, stale: soc.stale };
}
