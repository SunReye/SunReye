import { describe, expect, test } from "bun:test";

import { type DeviceBattery, derivePlantBattery, resolveNominalV } from "./batteries";

/** A pack with everything stated, so each test varies only what it is about. */
function pack(overrides: Partial<DeviceBattery> = {}): DeviceBattery {
  return { usableKwh: 10, maxChargeW: 5000, minSoc: 10, nominalV: 51.2, ...overrides };
}

describe("derivePlantBattery", () => {
  test("no packs at all is null, not an empty battery", () => {
    // The forecast's battery field is nullable so "no storage" and "storage with
    // nothing in it" stay different things.
    expect(derivePlantBattery([])).toBeNull();
  });

  test("one pack is the identity — which is why the two-device cases below exist", () => {
    expect(derivePlantBattery([pack()])).toEqual({
      usableKwh: 10,
      maxChargeW: 5000,
      minSoc: 10,
      nominalV: 51.2,
    });
  });

  test("TWO packs: capacity and charge power sum", () => {
    const derived = derivePlantBattery([
      pack({ usableKwh: 30, maxChargeW: 9000 }),
      pack({ usableKwh: 5, maxChargeW: 2500 }),
    ]);
    expect(derived?.usableKwh).toBe(35);
    expect(derived?.maxChargeW).toBe(11500);
  });

  test("TWO packs: minSoc is capacity-weighted, not averaged", () => {
    // 5 % of 30 kWh = 1.5, 50 % of 5 kWh = 2.5 -> 4 kWh reserved of 35 = 11.43 %.
    // The plain mean would say 27.5 %, reserving 9.6 kWh that does not exist —
    // the forecast would curtail surplus it could store and the engine would
    // stop discharging with usable energy left.
    const derived = derivePlantBattery([
      pack({ usableKwh: 30, minSoc: 5 }),
      pack({ usableKwh: 5, minSoc: 50 }),
    ]);
    expect(derived?.minSoc).toBeCloseTo(11.428571, 6);
    expect(derived?.minSoc).not.toBeCloseTo(27.5, 6);
  });

  test("weighting is exact when the packs are the same size", () => {
    // The one case where the weighted result and the mean agree; asserted so a
    // future 'simplification' back to a mean fails on the case above, not here.
    const derived = derivePlantBattery([pack({ minSoc: 10 }), pack({ minSoc: 30 })]);
    expect(derived?.minSoc).toBeCloseTo(20, 10);
  });

  test("one unbounded pack makes the plant unbounded", () => {
    // Summing the rest would report a ceiling the plant does not have.
    const derived = derivePlantBattery([pack({ maxChargeW: 5000 }), pack({ maxChargeW: null })]);
    expect(derived?.maxChargeW).toBeNull();
  });

  test("every pack unbounded is still unbounded", () => {
    expect(
      derivePlantBattery([pack({ maxChargeW: null }), pack({ maxChargeW: null })])?.maxChargeW,
    ).toBeNull();
  });

  test("nominalV is the first stated value, never a mean of voltages", () => {
    const derived = derivePlantBattery([pack({ nominalV: null }), pack({ nominalV: 48 })]);
    expect(derived?.nominalV).toBe(48);
    const mixed = derivePlantBattery([pack({ nominalV: 48 }), pack({ nominalV: 51.2 })]);
    // 49.6 V is a voltage no pack runs at, and every commanded current is
    // scaled by this number.
    expect(mixed?.nominalV).toBe(48);
  });

  test("no pack states a voltage", () => {
    expect(derivePlantBattery([pack({ nominalV: null })])?.nominalV).toBeNull();
  });

  test("zero total capacity falls back to the plain mean instead of dividing by zero", () => {
    // Reachable: a pack row exists before its capacity has been measured.
    const derived = derivePlantBattery([
      pack({ usableKwh: 0, minSoc: 10 }),
      pack({ usableKwh: 0, minSoc: 30 }),
    ]);
    expect(derived?.usableKwh).toBe(0);
    expect(derived?.minSoc).toBe(20);
  });

  test("a 0 % floor is a floor, not an absent one", () => {
    const derived = derivePlantBattery([pack({ usableKwh: 10, minSoc: 0 })]);
    expect(derived?.minSoc).toBe(0);
  });

  test("a 100 % floor reserves everything", () => {
    const derived = derivePlantBattery([
      pack({ usableKwh: 10, minSoc: 100 }),
      pack({ usableKwh: 10, minSoc: 0 }),
    ]);
    expect(derived?.minSoc).toBe(50);
  });
});

describe("resolveNominalV", () => {
  test("the device's own value wins", () => {
    expect(resolveNominalV(48, 51.2, 52)).toBe(48);
  });

  test("falls back to the 1.x plant record when the device row states nothing", () => {
    // An install that set it on the plant page before 2.0.0 keeps charging at
    // that voltage until someone restates it on the device.
    expect(resolveNominalV(null, 48, 51.2)).toBe(48);
  });

  test("falls back to the automations field, where it lived before that", () => {
    expect(resolveNominalV(null, null, 48)).toBe(48);
  });

  test("null when nothing ever stated one", () => {
    // Deliberately not 51.2: a default here would shadow the legacy value and
    // silently change what an existing install charges at.
    expect(resolveNominalV(null, null, null)).toBeNull();
    expect(resolveNominalV(undefined, undefined)).toBeNull();
  });

  test("a stated 0 is not treated as absent", () => {
    // `??` and not `||`: 0 V is nonsense, but it is a stated value, and turning
    // it into a silent 51.2 would hide a misconfiguration that scales every
    // commanded current.
    expect(resolveNominalV(0, 51.2)).toBe(0);
  });
});
