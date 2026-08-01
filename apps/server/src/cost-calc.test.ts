import { type TariffConfig, tariffConfigSchema } from "@SunReye/db/tariff";
import { describe, expect, test } from "bun:test";
import { type HourEnergy, allocateCost, resolveRange } from "./cost-calc";

/** A tariff: 0.40 peak (08–20 weekdays), 0.10 off-peak default, 0.05 feed-in. */
const tariff: TariffConfig = tariffConfigSchema.parse({
  currency: "EUR",
  standingChargeMonthly: 30.4375, // → exactly 1.00 / day
  import: {
    defaultPricePerKwh: 0.1,
    bands: [{ name: "Peak", pricePerKwh: 0.4, startHour: 8, endHour: 20, days: [1, 2, 3, 4, 5] }],
  },
  export: { feedInPerKwh: 0.05 },
});

/** A given local date + hour, with energy figures. */
const hour = (iso: string, e: Partial<Omit<HourEnergy, "time">>): HourEnergy => ({
  time: new Date(iso),
  import: 0,
  export: 0,
  load: 0,
  production: 0,
  batteryDischarge: 0,
  ...e,
});

describe("allocateCost", () => {
  test("prices peak vs off-peak by local hour and weekday", () => {
    // 2024-01-01 is a Monday. 10:00 = peak (0.40), 02:00 = off-peak (0.10).
    const hours = [
      hour("2024-01-01T10:00:00", { import: 2 }), // 2 kWh * 0.40 = 0.80
      hour("2024-01-01T02:00:00", { import: 3 }), // 3 kWh * 0.10 = 0.30
    ];
    const r = allocateCost(hours, tariff, 1);
    expect(r.importKwh).toBe(5);
    expect(r.importCost).toBeCloseTo(1.1, 6);
    expect(r.byBand.find((b) => b.name === "Peak")?.cost).toBeCloseTo(0.8, 6);
    expect(r.byBand.find((b) => b.name === "Standard")?.cost).toBeCloseTo(0.3, 6);
  });

  test("weekend falls back to default rate (band is weekday-only)", () => {
    // 2024-01-06 is a Saturday → 10:00 is off-peak despite being 08–20.
    const r = allocateCost([hour("2024-01-06T10:00:00", { import: 1 })], tariff, 1);
    expect(r.importCost).toBeCloseTo(0.1, 6);
  });

  test("export earnings, net, savings and ratios", () => {
    const hours = [hour("2024-01-01T10:00:00", { import: 1, export: 4, load: 5, production: 10 })];
    const r = allocateCost(hours, tariff, 1);
    expect(r.exportEarnings).toBeCloseTo(0.2, 6); // 4 * 0.05
    expect(r.importCost).toBeCloseTo(0.4, 6); // 1 * 0.40
    expect(r.standingCharge).toBeCloseTo(1.0, 6); // 1 day
    expect(r.net).toBeCloseTo(0.4 - 0.2 + 1.0, 6);
    // grid-only: all 5 kWh load at peak 0.40 = 2.00; savings = 2.00 - 0.40 + 0.20
    expect(r.gridOnlyCost).toBeCloseTo(2.0, 6);
    expect(r.savings).toBeCloseTo(1.8, 6);
    expect(r.selfSufficiency).toBeCloseTo((5 - 1) / 5, 6);
    expect(r.selfConsumption).toBeCloseTo((10 - 4) / 10, 6);
  });

  test("clamps ratios and handles no data", () => {
    const r = allocateCost([], tariff, 0);
    expect(r.importCost).toBe(0);
    expect(r.selfSufficiency).toBeNull();
    expect(r.selfConsumption).toBeNull();
  });

  test("battery discharge is carried but never priced (money unchanged)", () => {
    const base = allocateCost([hour("2024-01-01T10:00:00", { import: 2 })], tariff, 1);
    const withBattery = allocateCost(
      [hour("2024-01-01T10:00:00", { import: 2, batteryDischarge: 5 })],
      tariff,
      1,
    );
    expect(withBattery.importCost).toBe(base.importCost);
    expect(withBattery.net).toBe(base.net);
    expect(withBattery.gridOnlyCost).toBe(base.gridOnlyCost);
  });

  test("groups by local day", () => {
    const r = allocateCost(
      [hour("2024-01-01T10:00:00", { import: 1 }), hour("2024-01-02T10:00:00", { import: 2 })],
      tariff,
      2,
    );
    expect(r.byDay.map((d) => d.date)).toEqual(["2024-01-01", "2024-01-02"]);
  });
});

describe("resolveRange", () => {
  test("month starts at the first of the month, local midnight", () => {
    const now = new Date("2024-03-15T13:37:00");
    const { from, to } = resolveRange("month", now);
    expect(from.getDate()).toBe(1);
    expect(from.getMonth()).toBe(2);
    expect(from.getHours()).toBe(0);
    expect(to).toBe(now);
  });

  test("year starts on Jan 1", () => {
    const { from } = resolveRange("year", new Date("2024-03-15T13:37:00"));
    expect(from.getMonth()).toBe(0);
    expect(from.getDate()).toBe(1);
  });
});

describe("§51 zero-value export", () => {
  const hour = (iso: string, exported: number) => ({
    time: new Date(iso),
    import: 0,
    export: exported,
    load: 0,
    production: exported,
    batteryDischarge: 0,
  });
  const tariff = tariffConfigSchema.parse({ export: { feedInPerKwh: 0.08 } });

  test("a fully negative hour earns nothing and is reported as such", () => {
    const totals = allocateCost([hour("2026-08-02T13:00:00", 4)], tariff, 1, () => 1);
    expect(totals.exportEarnings).toBe(0);
    expect(totals.zeroValueExportKwh).toBeCloseTo(4, 10);
    // And says what that cost: 4 kWh that would have earned 8 ct each.
    expect(totals.zeroValueExportEur).toBeCloseTo(4 * 0.08, 10);
  });

  test("a partly negative hour is prorated", () => {
    // Two of four quarter-hours negative: half the export earns the tariff.
    const totals = allocateCost([hour("2026-08-02T13:00:00", 4)], tariff, 1, () => 0.5);
    expect(totals.exportEarnings).toBeCloseTo(2 * 0.08, 10);
    expect(totals.zeroValueExportKwh).toBeCloseTo(2, 10);
  });

  test("without the share, pricing is exactly as before", () => {
    const totals = allocateCost([hour("2026-08-02T13:00:00", 4)], tariff, 1);
    expect(totals.exportEarnings).toBeCloseTo(4 * 0.08, 10);
    expect(totals.zeroValueExportKwh).toBe(0);
  });

  test("the net figure rises by exactly the lost earnings", () => {
    const paid = allocateCost([hour("2026-08-02T13:00:00", 4)], tariff, 1);
    const unpaid = allocateCost([hour("2026-08-02T13:00:00", 4)], tariff, 1, () => 1);
    expect(unpaid.net - paid.net).toBeCloseTo(4 * 0.08, 10);
  });
});
