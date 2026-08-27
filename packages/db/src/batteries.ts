/**
 * The PLANT battery, derived from the device rows.
 *
 * The forecast's clipping model and the peak-shaving engine both read one
 * plant-level battery: how much energy there is to soak up surplus, how fast it
 * can take it, and how much of it is reserved. Until 2.0.0 that record WAS the
 * storage — a single `weather.forecast.battery` object in `app_settings` — so
 * there was nothing to derive. Now a pack belongs to the device that reports it
 * (`./schema/plants.ts`, `batteries`), and the plant-level record is computed
 * from however many of those exist.
 *
 * WHY THIS IS A MODULE WITH TESTS AND NOT THREE LINES AT THE CALL SITE
 *
 * With one device every rule below is the identity function. That is exactly why
 * it would ship wrong: `usableKwh` and `maxChargeW` are energies and powers and
 * add, but `minSoc` is a FRACTION, and averaging fractions across packs of
 * different sizes is wrong in the direction that matters — a 5 % floor on a
 * 30 kWh pack and a 50 % floor on a 5 kWh pack is not a 27.5 % plant floor, it is
 * 11.4 %. Getting it wrong overstates the reserve, which makes the forecast
 * curtail surplus it could have stored and makes the engine stop discharging
 * with usable energy left. So the arithmetic is capacity-weighted, and the test
 * that proves it uses TWO devices.
 */

/** One device's pack, as the derivation needs it. */
export interface DeviceBattery {
  usableKwh: number;
  /** Max charge power in W, or null for "unbounded within the hour". */
  maxChargeW: number | null;
  /** Reserve floor in %, 0–100. */
  minSoc: number;
  /** Nominal pack voltage in V, or null when never stated. */
  nominalV: number | null;
}

/** The plant-level battery the forecast and the engine read. */
export interface PlantBattery {
  usableKwh: number;
  maxChargeW: number | null;
  minSoc: number;
  nominalV: number | null;
}

/**
 * Combine the plant's packs into the one record the forecast models.
 *
 * `null` when there are no packs: the forecast's battery field is nullable
 * precisely so "no storage" is distinguishable from "storage with nothing in it",
 * and a plant of meters and chargers has no pack at all.
 *
 * Rules, and each is a decision:
 *
 *  - `usableKwh` SUMS. Two packs hold what both hold.
 *  - `minSoc` is CAPACITY-WEIGHTED: the plant floor is the reserved energy over
 *    the total energy. With one pack this is that pack's floor, unchanged.
 *  - `maxChargeW` sums only when EVERY pack states one. A single `null` means
 *    that pack is unbounded within the hour, so the plant is too — summing the
 *    rest would report a ceiling the plant does not have, and the clipping model
 *    would curtail surplus the pack would have absorbed. Erring toward
 *    "unbounded" is the same choice the field's own default made.
 *  - `nominalV` is the first stated value, NOT a mean. It converts watts to
 *    charge-current amps for a register write, and a mean of 48 and 51.2 is a
 *    voltage no pack runs at. Mixed voltages across packs is a configuration
 *    this cannot express, and averaging them would hide that rather than leave
 *    it visible.
 */
// fallow-ignore-next-line unused-export -- the plant-battery derivation the forecast and the peak-shaving engine will read; apps/server still reads the 1.x `weather.forecast.battery` record and is re-pointed at this in wave 3. Proved by batteries.test.ts, and test files are not traced as consumers.
export function derivePlantBattery(packs: readonly DeviceBattery[]): PlantBattery | null {
  if (packs.length === 0) return null;

  const usableKwh = packs.reduce((sum, p) => sum + p.usableKwh, 0);
  const reservedKwh = packs.reduce((sum, p) => sum + (p.usableKwh * p.minSoc) / 100, 0);

  const anyUnbounded = packs.some((p) => p.maxChargeW === null);
  const maxChargeW = anyUnbounded ? null : packs.reduce((sum, p) => sum + (p.maxChargeW ?? 0), 0);

  // A zero-capacity pack set would divide by zero; report the plain mean of the
  // floors instead, which is the only reading of "reserve" left when there is no
  // energy to weight by. Reachable: a pack row exists before its capacity is
  // measured or entered.
  const minSoc =
    usableKwh > 0
      ? (reservedKwh / usableKwh) * 100
      : packs.reduce((sum, p) => sum + p.minSoc, 0) / packs.length;

  const nominalV = packs.find((p) => p.nominalV !== null)?.nominalV ?? null;

  return { usableKwh, maxChargeW, minSoc, nominalV };
}

/**
 * The stated pack voltage, across all three places it has lived.
 *
 * `nominalV` has now moved TWICE — the automations page, then the plant's
 * forecast record, now the battery row — and each move carries the same hazard:
 * every commanded charge current is scaled by this number, so a 48 V pack driven
 * as 51.2 V is charged 7 % below what was asked for, silently and forever.
 *
 * The existing chain (`apps/server/src/automation/peak-shaving-engine.ts`,
 * `liveBatteryV`) already prefers a live `battery.voltage` reading over any
 * stated value; this function is only about the stated ones, in the order they
 * were introduced:
 *
 *  1. the device's battery row — where it lives now;
 *  2. `weather.forecast.battery.nominalV` — where it lived in 1.x, and still
 *     holds the value for any install that set it there;
 *  3. `automation.peakShaving.nominalBatteryV` — where it lived before that.
 *
 * All three are nullable/optional for the same reason the second one was made
 * nullable rather than defaulted: a default here would SHADOW the legacy value
 * with 51.2 and quietly change what an existing install charges at. Returning
 * `null` when nothing states one is what lets the caller keep using the legacy
 * default it already has.
 */
// fallow-ignore-next-line unused-export -- the three-place fallback for a value that has now moved twice; wired in wave 3 alongside peak-shaving-engine's liveBatteryV. Proved by batteries.test.ts.
export function resolveNominalV(
  deviceValue: number | null | undefined,
  legacyPlantValue: number | null | undefined,
  legacyAutomationValue?: number | null,
): number | null {
  return deviceValue ?? legacyPlantValue ?? legacyAutomationValue ?? null;
}
