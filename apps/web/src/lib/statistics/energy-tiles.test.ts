import { describe, expect, test } from "bun:test";
import type { CostTotals } from "server/src/cost-calc";
import { costFormatters } from "../cost/format";
import { deriveTiles, ENERGY_TILES, type EnergyTileData } from "./tiles";

const f = costFormatters("EUR");

/** A month of plausible totals; overrides shape each scenario. */
const totals = (over: Partial<CostTotals> = {}): CostTotals => ({
  importKwh: 100,
  exportKwh: 50,
  loadKwh: 160,
  productionKwh: 120,
  batteryDischargeKwh: 20,
  batteryChargeKwh: 22,
  importCost: 30,
  exportEarnings: 4,
  zeroValueExportKwh: 0,
  zeroValueExportEur: 0,
  standingCharge: 10,
  net: 36,
  gridOnlyCost: 48,
  savings: 22,
  solarSavings: 18,
  selfConsumedKwh: 60,
  selfSufficiency: 0.375,
  selfConsumption: 0.5833,
  byDay: [],
  byBand: [],
  ...over,
});

const data = (over: Partial<EnergyTileData> = {}): EnergyTileData => ({
  current: totals(),
  previous: totals(),
  rangeDays: 10,
  hasBattery: true,
  ...over,
});

const tiles = (d: EnergyTileData) => deriveTiles(ENERGY_TILES, d, f);
const byId = (d: EnergyTileData, id: string) => tiles(d).find((t) => t.id === id);

describe("ENERGY_TILES registry", () => {
  test("declares the five totals in render order", () => {
    expect(ENERGY_TILES.map((t) => t.id)).toEqual([
      "energy.produced",
      "energy.consumed",
      "energy.selfUsed",
      "energy.batteryCharged",
      "energy.batteryDischarged",
    ]);
  });

  test("every def carries a raw accessor and a good direction", () => {
    for (const def of ENERGY_TILES) {
      expect(typeof def.raw).toBe("function");
      expect(["up", "down", "neutral"]).toContain(def.goodDirection);
    }
  });
});

describe("headline figures", () => {
  test("read the window's totals as kWh", () => {
    const d = data();
    expect(byId(d, "energy.produced")?.value).toBe("120 kWh");
    expect(byId(d, "energy.consumed")?.value).toBe("160 kWh");
    expect(byId(d, "energy.selfUsed")?.value).toBe("60 kWh");
    expect(byId(d, "energy.batteryCharged")?.value).toBe("22 kWh");
    expect(byId(d, "energy.batteryDischarged")?.value).toBe("20 kWh");
  });

  test("raw exposes the same unformatted figure", () => {
    const def = ENERGY_TILES.find((t) => t.id === "energy.produced");
    expect(def?.raw(data())).toBe(120);
  });
});

describe("per-day sub-line", () => {
  test("divides the total by the window length", () => {
    expect(byId(data(), "energy.produced")?.sub).toBe("12 kWh/day");
  });

  test("carries no delta of its own — that is the chip's job", () => {
    const d = data({ previous: totals({ productionKwh: 100 }) });
    expect(byId(d, "energy.produced")?.sub).toBe("12 kWh/day");
  });
});

/** The reference window as the energy section builds it. */
const reference = (over: Partial<CostTotals> = {}): EnergyTileData => ({
  current: totals(over),
  previous: null,
  rangeDays: 10,
  hasBattery: true,
});

const deltaOf = (previous: EnergyTileData | undefined, id: string) =>
  deriveTiles(ENERGY_TILES, data(), f, previous).find((t) => t.id === id)?.delta;

describe("delta against the reference window", () => {
  test("is the signed relative change", () => {
    expect(deltaOf(reference({ productionKwh: 100 }), "energy.produced")).toBeCloseTo(0.2, 5);
    expect(deltaOf(reference({ productionKwh: 150 }), "energy.produced")).toBeCloseTo(-0.2, 5);
  });

  test("is absent entirely when no reference window was passed", () => {
    expect(deltaOf(undefined, "energy.produced")).toBeUndefined();
  });

  test("is null against a zero baseline — no fake +∞", () => {
    expect(deltaOf(reference({ productionKwh: 0 }), "energy.produced")).toBeNull();
  });
});

describe("battery capability gating", () => {
  test("keeps both battery tiles on a plant with a pack, even in an idle window", () => {
    const d = data({
      current: totals({ batteryChargeKwh: 0, batteryDischargeKwh: 0 }),
      previous: totals({ batteryChargeKwh: 0, batteryDischargeKwh: 0 }),
    });
    expect(byId(d, "energy.batteryCharged")?.value).toBe("0 kWh");
    expect(byId(d, "energy.batteryDischarged")?.value).toBe("0 kWh");
  });

  test("drops both battery tiles on a plant with no pack and no battery energy", () => {
    const d = data({
      hasBattery: false,
      current: totals({ batteryChargeKwh: 0, batteryDischargeKwh: 0 }),
      previous: totals({ batteryChargeKwh: 0, batteryDischargeKwh: 0 }),
    });
    expect(tiles(d).map((t) => t.id)).toEqual([
      "energy.produced",
      "energy.consumed",
      "energy.selfUsed",
    ]);
  });

  test("keeps them when the manifest is silent but the window moved battery energy", () => {
    const d = data({ hasBattery: false });
    expect(byId(d, "energy.batteryDischarged")?.value).toBe("20 kWh");
  });

  test("raw is null for a tile that does not apply", () => {
    const d = data({
      hasBattery: false,
      current: totals({ batteryChargeKwh: 0, batteryDischargeKwh: 0 }),
      previous: totals({ batteryChargeKwh: 0, batteryDischargeKwh: 0 }),
    });
    expect(ENERGY_TILES.find((t) => t.id === "energy.batteryCharged")?.raw(d)).toBeNull();
  });
});
