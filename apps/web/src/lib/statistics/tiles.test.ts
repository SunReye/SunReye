import { describe, expect, test } from "bun:test";
import type { CostBreakdown } from "server/src/cost-calc";
import { costFormatters } from "../cost/format";
import { COST_TILES, deriveTiles } from "./tiles";

const f = costFormatters("EUR");

/** A month of plausible figures; overrides shape each scenario. */
const breakdown = (over: Partial<CostBreakdown> = {}): CostBreakdown => ({
  currency: "EUR",
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-08-01T00:00:00.000Z",
  importKwh: 100,
  exportKwh: 50,
  loadKwh: 160,
  productionKwh: 120,
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

const tileById = (data: CostBreakdown, id: string) => {
  const tile = deriveTiles(COST_TILES, data, f).find((t) => t.id === id);
  if (!tile) throw new Error(`tile ${id} missing`);
  return tile;
};

describe("COST_TILES registry", () => {
  test("declares all nine tiles in render order", () => {
    expect(COST_TILES.map((d) => d.id)).toEqual([
      "cost.gridCost",
      "cost.zeroValueExport",
      "cost.effectiveCost",
      "cost.gridImport",
      "cost.gridExport",
      "cost.solarSaving",
      "cost.totalSavings",
      "cost.selfSufficiency",
      "cost.selfConsumption",
    ]);
  });

  test("every def carries a raw accessor and a good direction", () => {
    for (const def of COST_TILES) {
      expect(typeof def.raw).toBe("function");
      expect(["up", "down", "neutral"]).toContain(def.goodDirection);
    }
  });
});

describe("grid cost", () => {
  test("adds the standing charge to the import cost", () => {
    const t = tileById(breakdown(), "cost.gridCost");
    expect(t.value).toBe(f.money(40));
    expect(t.sub).toContain(f.money(30));
    expect(t.sub).toContain(f.money(10));
    expect(t.accent).toBe("");
  });

  test("raw matches the rendered figure", () => {
    const def = COST_TILES.find((d) => d.id === "cost.gridCost");
    expect(def?.raw(breakdown())).toBe(40);
  });
});

describe("§51 zero-value export", () => {
  test("is omitted when nothing was exported for free", () => {
    const ids = deriveTiles(COST_TILES, breakdown(), f).map((t) => t.id);
    expect(ids).not.toContain("cost.zeroValueExport");
    expect(ids).toHaveLength(8);
  });

  test("appears second once §51 has cost something", () => {
    const data = breakdown({ zeroValueExportKwh: 3.2, zeroValueExportEur: 0.25 });
    const tiles = deriveTiles(COST_TILES, data, f);
    expect(tiles).toHaveLength(9);
    expect(tiles[1]?.id).toBe("cost.zeroValueExport");
    expect(tiles[1]?.value).toBe(f.kwh(3.2));
    expect(tiles[1]?.sub).toContain(f.money(0.25));
  });
});

describe("effective cost", () => {
  test("shows net without accent when positive", () => {
    const t = tileById(breakdown(), "cost.effectiveCost");
    expect(t.value).toBe(f.money(36));
    expect(t.accent).toBe("");
  });

  test("turns green when feed-in outweighs the bill", () => {
    const t = tileById(breakdown({ net: -5 }), "cost.effectiveCost");
    expect(t.value).toBe(f.money(-5));
    expect(t.accent).toBe("text-emerald-500");
  });
});

describe("grid import / export", () => {
  test("import shows cost with the energy sub-line, never green", () => {
    const t = tileById(breakdown(), "cost.gridImport");
    expect(t.value).toBe(f.money(30));
    expect(t.sub).toContain(f.kwh(100));
    expect(t.accent).toBe("");
  });

  test("export earnings turn green only when non-zero", () => {
    expect(tileById(breakdown(), "cost.gridExport").accent).toBe("text-emerald-500");
    expect(tileById(breakdown({ exportEarnings: 0 }), "cost.gridExport").accent).toBe("");
  });
});

describe("solar saving", () => {
  test("breaks the saving into kWh × effective price", () => {
    const t = tileById(breakdown(), "cost.solarSaving");
    expect(t.value).toBe(f.money(18));
    // 18 € over 60 kWh self-consumed = 0.30 €/kWh effective.
    expect(t.sub).toBe(`${f.kwh(60)} × ${f.price(0.3)}`);
    expect(t.accent).toBe("text-emerald-500");
  });

  test("falls back to the generic sub-line without self-consumption", () => {
    const t = tileById(breakdown({ selfConsumedKwh: 0, solarSavings: 0 }), "cost.solarSaving");
    expect(t.sub).not.toContain("×");
    expect(t.accent).toBe("");
  });
});

describe("total savings", () => {
  test("shows the savings figure, green when positive", () => {
    const t = tileById(breakdown(), "cost.totalSavings");
    expect(t.value).toBe(f.money(22));
    expect(t.accent).toBe("text-emerald-500");
    expect(t.sub).toContain(f.money(4));
  });
});

describe("self-sufficiency / self-consumption ratios", () => {
  test("render as whole percents", () => {
    expect(tileById(breakdown(), "cost.selfSufficiency").value).toBe("38%");
    expect(tileById(breakdown(), "cost.selfConsumption").value).toBe("58%");
  });

  test("render an em-dash when the server reports null", () => {
    const data = breakdown({ selfSufficiency: null, selfConsumption: null });
    expect(tileById(data, "cost.selfSufficiency").value).toBe("—");
    expect(tileById(data, "cost.selfConsumption").value).toBe("—");
  });

  test("raw passes the nullable ratio through", () => {
    const def = COST_TILES.find((d) => d.id === "cost.selfSufficiency");
    expect(def?.raw(breakdown())).toBe(0.375);
    expect(def?.raw(breakdown({ selfSufficiency: null }))).toBeNull();
  });
});
