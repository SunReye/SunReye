import { describe, expect, test } from "bun:test";
import type { CostBreakdown } from "@SunReye/contracts/energy";
import type { SpotStats, SpotWhatIf } from "server/src/statistics/spot-stats";
import type { RecordsResponse } from "server/src/statistics/statistics";
import { costFormatters } from "../cost/format";
import {
  COMPARISON_TILES,
  COST_TILES,
  PRICE_TILES,
  RECORD_TILES,
  WHATIF_TILES,
  deriveTiles,
} from "./tiles";

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
  solarToLoadKwh: 60,
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

  test("signs the forgone energy against the reference window", () => {
    // Two consecutive months of negative-price curtailment: the tile is the one
    // place the household sees §51 growing, so it needs its chip like any other.
    const data = breakdown({ zeroValueExportKwh: 6, zeroValueExportEur: 0.5 });
    const previous = breakdown({ zeroValueExportKwh: 4, zeroValueExportEur: 0.3 });
    const tile = deriveTiles(COST_TILES, data, f, previous).find(
      (t) => t.id === "cost.zeroValueExport",
    );
    expect(tile?.delta).toBeCloseTo(0.5, 5);
    expect(COST_TILES.find((d) => d.id === "cost.zeroValueExport")?.raw(data)).toBe(6);
  });

  test("has no chip against a reference window §51 never touched", () => {
    const data = breakdown({ zeroValueExportKwh: 6, zeroValueExportEur: 0.5 });
    const tile = deriveTiles(COST_TILES, data, f, breakdown()).find(
      (t) => t.id === "cost.zeroValueExport",
    );
    expect(tile?.delta).toBeNull();
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

  test("stays uncoloured on a month that exactly broke even", () => {
    // Breaking even is not money in the household's pocket; only a credit is.
    const t = tileById(breakdown({ net: 0 }), "cost.effectiveCost");
    expect(t.value).toBe(f.money(0));
    expect(t.accent).toBe("");
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
    const t = tileById(breakdown({ solarToLoadKwh: 0, solarSavings: 0 }), "cost.solarSaving");
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

  test("greens nothing on a window solar saved nothing in", () => {
    // A dark December week, or a plant down for service: zero saved is not a
    // saving, and a negative one (standing charges on a dead plant) less so.
    expect(tileById(breakdown({ savings: 0 }), "cost.totalSavings").accent).toBe("");
    expect(tileById(breakdown({ savings: -2.4 }), "cost.totalSavings").value).toBe(f.money(-2.4));
    expect(tileById(breakdown({ savings: -2.4 }), "cost.totalSavings").accent).toBe("");
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

describe("COMPARISON_TILES registry", () => {
  const comparison = (data: CostBreakdown, previous?: CostBreakdown) =>
    deriveTiles(COMPARISON_TILES, data, f, previous);
  const byId = (data: CostBreakdown, id: string) => {
    const tile = comparison(data).find((t) => t.id === id);
    if (!tile) throw new Error(`tile ${id} missing`);
    return tile;
  };

  test("leads with the household's four headline figures", () => {
    expect(comparison(breakdown()).map((t) => t.id)).toEqual([
      "records.netCost",
      "records.savings",
      "records.import",
      "records.selfSufficiency",
    ]);
  });

  test("never drops a tile — the row is the same four every window", () => {
    // A month with no import, no export and no saving is still four tiles: the
    // section's caption promises a comparison, and a missing tile would read as
    // a broken fetch rather than a quiet month.
    const quiet = breakdown({
      importKwh: 0,
      importCost: 0,
      exportEarnings: 0,
      savings: 0,
      net: 0,
      selfSufficiency: 0,
    });
    expect(comparison(quiet)).toHaveLength(4);
    expect(byId(quiet, "records.import").value).toBe(f.kwh(0));
    expect(byId(quiet, "records.selfSufficiency").value).toBe("0%");
  });

  test("states the period's net cost, green only once feed-in outweighs the bill", () => {
    expect(byId(breakdown(), "records.netCost").value).toBe(f.money(36));
    expect(byId(breakdown(), "records.netCost").accent).toBe("");
    expect(byId(breakdown({ net: -12.5 }), "records.netCost").accent).toBe("text-emerald-500");
    // Breaking even is not in the household's favour, so it stays uncoloured.
    expect(byId(breakdown({ net: 0 }), "records.netCost").accent).toBe("");
  });

  test("states what solar saved, green only once it saved something", () => {
    expect(byId(breakdown(), "records.savings").value).toBe(f.money(22));
    expect(byId(breakdown(), "records.savings").accent).toBe("text-emerald-500");
    expect(byId(breakdown({ savings: 0 }), "records.savings").accent).toBe("");
    expect(byId(breakdown({ savings: -3 }), "records.savings").accent).toBe("");
  });

  test("reads grid import as energy with its cost underneath", () => {
    // The cost section leads with the money; here the energy is the headline,
    // because a period-over-period import comparison is about consumption.
    const t = byId(breakdown(), "records.import");
    expect(t.value).toBe(f.kwh(100));
    expect(t.sub).toContain(f.money(30));
    expect(t.accent).toBe("");
  });

  test("restates self-sufficiency rather than re-deriving it", () => {
    // Same label, same figure, same sub-line as the cost section's tile — only
    // the id and the explanation differ, so the two can never drift apart.
    const restated = byId(breakdown(), "records.selfSufficiency");
    const original = tileById(breakdown(), "cost.selfSufficiency");
    expect(restated.value).toBe(original.value);
    expect(restated.label).toBe(original.label);
    expect(restated.sub).toBe(original.sub);
    expect(restated.goodDirection).toBe(original.goodDirection);
    expect(restated.explain).not.toBe(original.explain);
    expect(restated.explain).toContain("reference period");
  });

  test("carries the same nullable ratio through as an em-dash", () => {
    expect(byId(breakdown({ selfSufficiency: null }), "records.selfSufficiency").value).toBe("—");
  });

  test("every figure is signed against the reference window", () => {
    const previous = breakdown({ net: 40, savings: 20, importKwh: 125, selfSufficiency: 0.3 });
    const tiles = comparison(breakdown(), previous);
    expect(tiles.find((t) => t.id === "records.netCost")?.delta).toBeCloseTo(-0.1, 5);
    expect(tiles.find((t) => t.id === "records.savings")?.delta).toBeCloseTo(0.1, 5);
    expect(tiles.find((t) => t.id === "records.import")?.delta).toBeCloseTo(-0.2, 5);
    expect(tiles.find((t) => t.id === "records.selfSufficiency")?.delta).toBeCloseTo(0.25, 5);
  });

  test("signs a move across zero against the reference's magnitude", () => {
    // A period that cost €10 and now earns €5 is −150%, not −50%: the sign says
    // the cost fell, and goodDirection "down" makes that the good news.
    const tiles = comparison(breakdown({ net: -5 }), breakdown({ net: 10 }));
    expect(tiles.find((t) => t.id === "records.netCost")?.delta).toBeCloseTo(-1.5, 5);
  });

  test("has no delta against a reference period that was flat at zero", () => {
    const tiles = comparison(breakdown(), breakdown({ savings: 0, selfSufficiency: 0 }));
    expect(tiles.find((t) => t.id === "records.savings")?.delta).toBeNull();
    expect(tiles.find((t) => t.id === "records.selfSufficiency")?.delta).toBeNull();
  });

  test("has no delta at all when no reference window was passed", () => {
    for (const tile of comparison(breakdown())) expect(tile.delta).toBeUndefined();
  });

  test("has no delta when the reference period could not report a ratio", () => {
    const tiles = comparison(breakdown(), breakdown({ selfSufficiency: null }));
    expect(tiles.find((t) => t.id === "records.selfSufficiency")?.delta).toBeNull();
  });
});

/** A month of market behaviour; overrides shape each scenario. */
const stats = (over: Partial<SpotStats> = {}): SpotStats => ({
  zone: "DE-LU",
  currency: "EUR",
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-08-01T00:00:00.000Z",
  summary: {
    avgEurPerMwh: 84.2,
    minEurPerMwh: -30,
    maxEurPerMwh: 240,
    slots: 2976,
    negativeSlots: 12,
    negativeHours: 3,
  },
  daily: [
    {
      date: "2026-07-04",
      avgEurPerMwh: 40,
      minEurPerMwh: -30,
      maxEurPerMwh: 90,
      slots: 96,
      negativeSlots: 12,
    },
    {
      date: "2026-07-18",
      avgEurPerMwh: 120,
      minEurPerMwh: 10,
      maxEurPerMwh: 240,
      slots: 96,
      negativeSlots: 0,
    },
  ],
  negativeWindows: [],
  negativeWindowsTruncated: false,
  paidVsMarket: {
    importKwh: 300,
    importWeightedAvgEurPerMwh: 70,
    coverage: 1,
  },
  whatIf: null,
  ...over,
});

describe("PRICE_TILES registry", () => {
  test("states the market figures in ct/kWh", () => {
    const tiles = deriveTiles(PRICE_TILES, stats(), f);
    expect(tiles.map((t) => t.id)).toEqual([
      "prices.marketAvg",
      "prices.marketMin",
      "prices.marketMax",
      "prices.negativeHours",
      "prices.paidVsMarket",
    ]);
    expect(tiles[0]?.value).toBe("8.42 ct");
    expect(tiles[1]?.value).toBe("-3.00 ct");
    expect(tiles[3]?.value).toBe("3 h");
  });

  test("names the day an extreme happened on", () => {
    const tiles = deriveTiles(PRICE_TILES, stats(), f);
    expect(tiles[1]?.sub).toContain("2026");
    expect(tiles[2]?.sub).toContain("2026");
  });

  test("drops every market tile when the window holds no slots", () => {
    expect(deriveTiles(PRICE_TILES, stats({ summary: null, paidVsMarket: null }), f)).toEqual([]);
  });

  test("greens the import price only when it beat the plain average", () => {
    expect(deriveTiles(PRICE_TILES, stats(), f).at(-1)?.accent).toBe("text-emerald-500");
    const missed = deriveTiles(
      PRICE_TILES,
      stats({
        paidVsMarket: {
          importKwh: 300,
          importWeightedAvgEurPerMwh: 95,
          coverage: 1,
        },
      }),
      f,
    ).at(-1);
    expect(missed?.accent).toBe("");
  });

  test("drops the import tile alone when nothing was imported in a priced hour", () => {
    const tiles = deriveTiles(PRICE_TILES, stats({ paidVsMarket: null }), f);
    expect(tiles.map((t) => t.id)).not.toContain("prices.paidVsMarket");
    expect(tiles).toHaveLength(4);
  });

  test("drops the import tile when there is no market average to state it against", () => {
    // The tile's whole sub-line is "vs the market average", so it needs BOTH
    // halves: an import weighting with no summary to compare it to has nothing
    // to say, and reading the missing summary would throw on render.
    const tiles = deriveTiles(
      PRICE_TILES,
      stats({
        summary: null,
        paidVsMarket: { importKwh: 300, importWeightedAvgEurPerMwh: 78, coverage: 1 },
      }),
      f,
    );
    expect(tiles).toEqual([]);
  });

  test("shows no accent when the house paid exactly the market average", () => {
    const level = deriveTiles(
      PRICE_TILES,
      stats({ paidVsMarket: { importKwh: 300, importWeightedAvgEurPerMwh: 84.2, coverage: 1 } }),
      f,
    ).at(-1);
    expect(level?.value).toBe("8.42 ct");
    expect(level?.accent).toBe("");
  });

  test("reports a window the market spent below zero as a negative average", () => {
    // A weekend of §51 hours can average below zero; a ct/kWh figure keeps its
    // sign rather than reading as free power.
    const tiles = deriveTiles(
      PRICE_TILES,
      stats({
        summary: {
          avgEurPerMwh: -12.5,
          minEurPerMwh: -80,
          maxEurPerMwh: 4,
          slots: 96,
          negativeSlots: 70,
          negativeHours: 17.5,
        },
      }),
      f,
    );
    expect(tiles[0]?.value).toBe("-1.25 ct");
    expect(tiles[1]?.value).toBe("-8.00 ct");
    expect(tiles[2]?.value).toBe("0.40 ct");
  });

  test("names the zone when no single day holds the window's extreme", () => {
    // The summary is folded over slots, the daily rows over days: a min that no
    // day's own min equals must not print a day it cannot identify.
    const tiles = deriveTiles(
      PRICE_TILES,
      stats({
        summary: {
          avgEurPerMwh: 84.2,
          minEurPerMwh: -55,
          maxEurPerMwh: 310,
          slots: 2976,
          negativeSlots: 12,
          negativeHours: 3,
        },
      }),
      f,
    );
    expect(tiles[1]?.sub).toBe("DE-LU, wholesale");
    expect(tiles[2]?.sub).toBe("DE-LU, wholesale");
  });

  test("names the zone on a window with no daily breakdown at all", () => {
    const tiles = deriveTiles(PRICE_TILES, stats({ daily: [] }), f);
    expect(tiles[1]?.sub).toBe("DE-LU, wholesale");
  });

  test("counts a single negative slot in the singular", () => {
    const one = deriveTiles(
      PRICE_TILES,
      stats({
        summary: {
          avgEurPerMwh: 84.2,
          minEurPerMwh: -2,
          maxEurPerMwh: 240,
          slots: 2976,
          negativeSlots: 1,
          negativeHours: 0.25,
        },
      }),
      f,
    )[3];
    expect(one?.sub).toBe("one slot below zero");
    // A quarter-hour is the market's finest slot; rounding it to 0 h would read
    // as "never negative", so the tile keeps a tenth of an hour.
    expect(one?.value).toBe("0.3 h");
  });

  test("still states a window the market never spent below zero", () => {
    const none = deriveTiles(
      PRICE_TILES,
      stats({
        summary: {
          avgEurPerMwh: 84.2,
          minEurPerMwh: 12,
          maxEurPerMwh: 240,
          slots: 2976,
          negativeSlots: 0,
          negativeHours: 0,
        },
      }),
      f,
    )[3];
    expect(none?.value).toBe("0 h");
    expect(none?.sub).toBe("0 slots below zero");
  });

  test("raw exposes the market figures for the delta chips, null without slots", () => {
    const raws = (s: SpotStats) => PRICE_TILES.map((d) => d.raw(s));
    expect(raws(stats())).toEqual([84.2, -30, 240, 3, 70]);
    expect(raws(stats({ summary: null, paidVsMarket: null }))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  test("signs each market figure against the reference window", () => {
    const previous = stats({
      summary: {
        avgEurPerMwh: 105.25,
        minEurPerMwh: -60,
        maxEurPerMwh: 200,
        slots: 2976,
        negativeSlots: 24,
        negativeHours: 6,
      },
    });
    const tiles = deriveTiles(PRICE_TILES, stats(), f, previous);
    expect(tiles[0]?.delta).toBeCloseTo(-0.2, 5);
    // Measured against the magnitude: a −30 min after a −60 one is a rise.
    expect(tiles[1]?.delta).toBeCloseTo(0.5, 5);
    expect(tiles[3]?.delta).toBeCloseTo(-0.5, 5);
  });

  test("has no delta when the reference window held no stored slots", () => {
    const empty = stats({ summary: null, paidVsMarket: null });
    const tiles = deriveTiles(PRICE_TILES, stats(), f, empty);
    expect(tiles.map((t) => t.delta)).toEqual([null, null, null, null, null]);
  });
});

describe("WHATIF_TILES registry", () => {
  const whatIf = (over: Partial<SpotWhatIf> = {}): SpotWhatIf => ({
    staticCost: 120,
    spotCost: 99,
    delta: -21,
    spotComponentsConfigured: true,
    coverage: 0.9,
    ...over,
  });

  test("prices the window both ways and greens a cheaper spot bill", () => {
    const tiles = deriveTiles(WHATIF_TILES, whatIf(), f);
    expect(tiles.map((t) => t.value)).toEqual([f.money(120), f.money(99), f.money(-21)]);
    expect(tiles.at(-1)?.accent).toBe("text-emerald-500");
  });

  test("says plainly when spot would have cost more", () => {
    const tiles = deriveTiles(WHATIF_TILES, whatIf({ spotCost: 150, delta: 30 }), f);
    expect(tiles.at(-1)?.accent).toBe("");
    expect(tiles.at(-1)?.value).toBe(f.money(30));
  });

  test("names the two sides so neither is mistaken for the real bill", () => {
    const tiles = deriveTiles(WHATIF_TILES, whatIf(), f);
    expect(tiles.map((t) => t.id)).toEqual([
      "prices.whatIfStatic",
      "prices.whatIfSpot",
      "prices.whatIfDelta",
    ]);
    expect(tiles[0]?.sub).toBe("Imported energy on your tariff");
    expect(tiles[1]?.sub).toBe("Same energy, priced hourly");
    expect(tiles[2]?.sub).toBe("Spot would have been cheaper");
  });

  test("treats an identical bill as no reason to switch", () => {
    // Zero is not a saving: the row must not green a tariff change that would
    // have made no difference.
    const tiles = deriveTiles(WHATIF_TILES, whatIf({ spotCost: 120, delta: 0 }), f);
    expect(tiles.at(-1)?.value).toBe(f.money(0));
    expect(tiles.at(-1)?.accent).toBe("");
    expect(tiles.at(-1)?.sub).toBe("Spot would have cost more");
  });

  test("prices a window that imported nothing at zero on both sides", () => {
    const tiles = deriveTiles(WHATIF_TILES, whatIf({ staticCost: 0, spotCost: 0, delta: 0 }), f);
    expect(tiles.map((t) => t.value)).toEqual([f.money(0), f.money(0), f.money(0)]);
    expect(tiles).toHaveLength(3);
  });

  test("greens a window spot would have paid the house for", () => {
    // Deep negative hours can make the repriced import a credit; the delta is
    // then larger than the static bill itself.
    const tiles = deriveTiles(WHATIF_TILES, whatIf({ spotCost: -8, delta: -128 }), f);
    expect(tiles[1]?.value).toBe(f.money(-8));
    expect(tiles.at(-1)?.value).toBe(f.money(-128));
    expect(tiles.at(-1)?.accent).toBe("text-emerald-500");
  });

  test("raw exposes both repriced bills and their difference", () => {
    expect(WHATIF_TILES.map((d) => d.raw(whatIf()))).toEqual([120, 99, -21]);
    expect(WHATIF_TILES.map((d) => d.goodDirection)).toEqual(["down", "down", "down"]);
  });

  test("signs the repricing against the reference window", () => {
    const tiles = deriveTiles(WHATIF_TILES, whatIf(), f, whatIf({ staticCost: 150, spotCost: 90 }));
    expect(tiles[0]?.delta).toBeCloseTo(-0.2, 5);
    expect(tiles[1]?.delta).toBeCloseTo(0.1, 5);
  });
});

/** All-time records as the server reports them; overrides shape each scenario. */
const energyRecords = (
  over: Partial<NonNullable<RecordsResponse["energy"]>> = {},
): NonNullable<RecordsResponse["energy"]> => ({
  since: "2024-03-02",
  maxProductionDay: { date: "2026-05-17", value: 68.4 },
  maxExportDay: { date: "2026-05-17", value: 41.2 },
  maxLoadDay: { date: "2026-01-08", value: 33.9 },
  maxImportDay: { date: "2026-01-08", value: 28.1 },
  bestSelfSufficiencyDay: { date: "2026-06-21", value: 0.97 },
  worstSelfSufficiencyDay: { date: "2025-12-19", value: 0 },
  ...over,
});

const records = (over: Partial<RecordsResponse> = {}): RecordsResponse => ({
  energy: energyRecords(),
  money: {
    since: "2025-11-01",
    currency: "EUR",
    cheapestDay: { date: "2026-05-17", value: -2.35 },
    mostExpensiveDay: { date: "2026-01-08", value: 14.2 },
    bestEarningsDay: { date: "2026-05-17", value: 6.7 },
  },
  ...over,
});

describe("RECORD_TILES registry", () => {
  const derived = (r: RecordsResponse) => deriveTiles(RECORD_TILES, r, f);
  const byId = (r: RecordsResponse, id: string) => derived(r).find((t) => t.id === id);

  test("declares the nine all-time records in render order", () => {
    expect(derived(records()).map((t) => t.id)).toEqual([
      "records.maxProduction",
      "records.maxExport",
      "records.maxLoad",
      "records.maxImport",
      "records.bestSelfSufficiency",
      "records.worstSelfSufficiency",
      "records.cheapestDay",
      "records.mostExpensiveDay",
      "records.bestEarningsDay",
    ]);
  });

  test("reads energy records as kWh and ratios as percents", () => {
    const r = records();
    expect(byId(r, "records.maxProduction")?.value).toBe(f.kwh(68.4));
    expect(byId(r, "records.maxExport")?.value).toBe(f.kwh(41.2));
    expect(byId(r, "records.maxLoad")?.value).toBe(f.kwh(33.9));
    expect(byId(r, "records.maxImport")?.value).toBe(f.kwh(28.1));
    expect(byId(r, "records.bestSelfSufficiency")?.value).toBe("97%");
  });

  test("reads money records in the plant's currency, credits included", () => {
    const r = records();
    // The cheapest day of a solar year is one the exports outearned the bill.
    expect(byId(r, "records.cheapestDay")?.value).toBe(f.money(-2.35));
    expect(byId(r, "records.mostExpensiveDay")?.value).toBe(f.money(14.2));
    expect(byId(r, "records.bestEarningsDay")?.value).toBe(f.money(6.7));
  });

  test("says which day held the record, in the reader's locale", () => {
    expect(byId(records(), "records.maxProduction")?.sub).toBe("May 17, 2026");
    expect(byId(records(), "records.maxLoad")?.sub).toBe("Jan 8, 2026");
  });

  test("keeps a record whose value is a legitimate zero", () => {
    // A December day the grid covered entirely is 0% self-sufficient — a real
    // record, not a missing one.
    const t = byId(records(), "records.worstSelfSufficiency");
    expect(t?.value).toBe("0%");
    expect(t?.sub).toBe("Dec 19, 2025");
  });

  test("drops a single record the plant has never set", () => {
    // A plant behind a zero feed-in limit never exports; the row simply has one
    // tile fewer rather than an empty one.
    const r = records({ energy: energyRecords({ maxExportDay: null }) });
    expect(derived(r).map((t) => t.id)).not.toContain("records.maxExport");
    expect(derived(r)).toHaveLength(8);
  });

  test("drops every money record outside the priced horizon", () => {
    // Money records only cover the window the server keeps hourly prices for;
    // the energy records reach back over the whole daily history.
    const tiles = derived(records({ money: null }));
    expect(tiles).toHaveLength(6);
    expect(tiles.map((t) => t.id)).not.toContain("records.cheapestDay");
    expect(tiles[0]?.id).toBe("records.maxProduction");
  });

  test("drops every energy record before there is a full day of history", () => {
    const tiles = derived(records({ energy: null }));
    expect(tiles.map((t) => t.id)).toEqual([
      "records.cheapestDay",
      "records.mostExpensiveDay",
      "records.bestEarningsDay",
    ]);
  });

  test("renders nothing at all on a plant recorded today", () => {
    expect(derived({ energy: null, money: null })).toEqual([]);
  });

  test("raw is the record's own figure, and null where there is no record", () => {
    const production = RECORD_TILES.find((t) => t.id === "records.maxProduction");
    const worst = RECORD_TILES.find((t) => t.id === "records.worstSelfSufficiency");
    const cheapest = RECORD_TILES.find((t) => t.id === "records.cheapestDay");
    expect(production?.raw(records())).toBe(68.4);
    // A zero record is a figure, not an absence — `?? null` must not swallow it.
    expect(worst?.raw(records())).toBe(0);
    expect(cheapest?.raw(records())).toBe(-2.35);
    expect(cheapest?.raw(records({ money: null }))).toBeNull();
    expect(production?.raw(records({ energy: null }))).toBeNull();
  });

  test("points each record the way the household reads it", () => {
    const direction = (id: string) => RECORD_TILES.find((t) => t.id === id)?.goodDirection;
    expect(direction("records.maxProduction")).toBe("up");
    expect(direction("records.maxImport")).toBe("down");
    expect(direction("records.mostExpensiveDay")).toBe("down");
    // Consumption is neither good nor bad news — the house used what it used.
    expect(direction("records.maxLoad")).toBe("neutral");
  });

  test("carries no delta — an all-time record has nothing to compare against", () => {
    for (const tile of derived(records())) expect(tile.delta).toBeUndefined();
  });
});

describe("deriveTiles", () => {
  test("calls the message functions rather than passing them through unresolved", () => {
    // A registry holds `() => string`; a tile holds the resolved text. Handing
    // the function to the component renders "function () { ... }" in the card.
    const tiles = deriveTiles(COST_TILES, breakdown(), f);
    const [first] = tiles;
    expect(first?.label).toBe("Grid cost");
    // Comparing against `COST_TILES[0].explain()` only re-reads the registry the
    // source read: it holds whatever that entry says, so it cannot tell a
    // correct resolution from one that resolved the wrong tile's text. Pin the
    // copy itself, and its defining claim — the bill *before* feed-in income.
    expect(typeof first?.explain).toBe("string");
    expect(first?.explain).toContain("imported energy priced at your tariff");
    expect(first?.explain).toContain("before feed-in income");
    // Every tile carries its own resolved text, not a shared or repeated one.
    const explains = tiles.map((t) => t.explain);
    expect(new Set(explains).size).toBe(explains.length);
  });

  test("yields nothing for an empty registry", () => {
    expect(deriveTiles([], breakdown(), f)).toEqual([]);
  });

  test("never computes a delta for a tile the current window drops", () => {
    // §51 cost the reference window something and cost this one nothing: the
    // tile is absent, so no chip claims a −100% that the reader cannot see.
    const previous = breakdown({ zeroValueExportKwh: 3.2, zeroValueExportEur: 0.25 });
    const tiles = deriveTiles(COST_TILES, breakdown(), f, previous);
    expect(tiles.map((t) => t.id)).not.toContain("cost.zeroValueExport");
  });

  test("keeps every tile's id, so hidden-tile preferences survive a re-derive", () => {
    const ids = deriveTiles(COST_TILES, breakdown(), f).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+\.[A-Za-z]+$/);
  });
});
