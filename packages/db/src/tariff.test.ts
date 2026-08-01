import { describe, expect, test } from "bun:test";
import {
  type TariffConfig,
  defaultTariff,
  exportPriceForSlot,
  importPriceAt,
  tariffConfigSchema,
} from "./tariff";

const tariff = (over: object = {}): TariffConfig =>
  tariffConfigSchema.parse({ currency: "EUR", ...over });

describe("schema totality", () => {
  // `readSetting` safeParses and falls back to the default *silently*, so a
  // schema that can reject a stored row would wipe a user's tariff with no
  // warning. These two tests are the guard against that, not a formality.
  test("a pre-change stored row still parses with its prices intact", () => {
    const stored = {
      currency: "EUR",
      standingChargeMonthly: 12.5,
      import: {
        defaultPricePerKwh: 0.3567,
        bands: [{ name: "Night", pricePerKwh: 0.21, startHour: 22, endHour: 6 }],
      },
      export: { feedInPerKwh: 0.0794 },
    };
    const parsed = tariffConfigSchema.parse(stored);
    expect(parsed.import.defaultPricePerKwh).toBe(0.3567);
    expect(parsed.import.bands[0]?.pricePerKwh).toBe(0.21);
    expect(parsed.export.feedInPerKwh).toBe(0.0794);
    expect(parsed.standingChargeMonthly).toBe(12.5);
    // The new fields materialize as the status quo: no behaviour change for a
    // plant that never opts in.
    expect(parsed.import.mode).toBe("static");
    expect(parsed.export.mode).toBe("static");
    expect(parsed.export.spot.marketingModel).toBe("none");
  });

  test("an empty row is the neutral default", () => {
    expect(tariffConfigSchema.parse({})).toEqual(defaultTariff);
    expect(defaultTariff.import.mode).toBe("static");
    expect(defaultTariff.export.spot.marketingModel).toBe("none");
  });

  test("import prices may be negative but a guaranteed feed-in rate may not", () => {
    // A rebate can push an energy price below zero; a guaranteed EEG tariff
    // cannot, and negative remuneration is computed from the market instead.
    expect(tariff({ import: { defaultPricePerKwh: -0.02 } }).import.defaultPricePerKwh).toBe(-0.02);
    expect(() => tariff({ export: { feedInPerKwh: -0.01 } })).toThrow();
  });
});

describe("landing a wholesale price on the bill", () => {
  // Exercised through importPriceAt, the one entry point callers use.
  const spot = (over: object = {}) =>
    tariff({
      import: {
        mode: "spot",
        defaultPricePerKwh: 0.35,
        spot: {
          supplierMarkupPerKwh: 0.015,
          gridFeesPerKwh: 0.09,
          leviesPerKwh: 0.03,
          vatPercent: 19,
          ...over,
        },
      },
    });

  test("wholesale plus markup plus fees plus levies, then VAT", () => {
    // 0.18 + 0.015 + 0.09 + 0.03 = 0.315 net → ×1.19
    expect(importPriceAt(spot(), 180, 12, 3)).toBeCloseTo(0.315 * 1.19, 10);
  });

  test("VAT applies to the whole sum including a negative wholesale part", () => {
    // -0.05 + 0.135 = 0.085 net → ×1.19. VATing only the positive components
    // would overstate the bill in exactly the hours this feature is about.
    expect(importPriceAt(spot(), -50, 12, 3)).toBeCloseTo(0.085 * 1.19, 10);
  });

  test("a landed price can go negative once the fees are small enough", () => {
    const bare = { supplierMarkupPerKwh: 0, gridFeesPerKwh: 0, leviesPerKwh: 0 };
    expect(importPriceAt(spot(bare), -50, 12, 3)).toBeLessThan(0);
  });

  test("clampToZero floors it, and is off by default", () => {
    const bare = { supplierMarkupPerKwh: 0, gridFeesPerKwh: 0, leviesPerKwh: 0 };
    expect(importPriceAt(spot({ ...bare, clampToZero: true }), -50, 12, 3)).toBe(0);
    expect(defaultTariff.import.spot.clampToZero).toBe(false);
  });
});

describe("exportPriceForSlot", () => {
  const feedIn = 0.0794;

  test("static mode ignores the market entirely", () => {
    const t = tariff({ export: { mode: "static", feedInPerKwh: feedIn } });
    expect(exportPriceForSlot(t, -80)).toBe(feedIn);
    expect(exportPriceForSlot(t, 200)).toBe(feedIn);
  });

  test("marketingModel none ignores the market even in spot mode", () => {
    const t = tariff({
      export: { mode: "spot", feedInPerKwh: feedIn, spot: { marketingModel: "none" } },
    });
    expect(exportPriceForSlot(t, -80)).toBe(feedIn);
  });

  test("§51: a negative slot pays nothing, a positive one pays the tariff", () => {
    const t = tariff({
      export: { mode: "spot", feedInPerKwh: feedIn, spot: { marketingModel: "eegFeedIn" } },
    });
    expect(exportPriceForSlot(t, -0.01)).toBe(0);
    expect(exportPriceForSlot(t, -80)).toBe(0);
    expect(exportPriceForSlot(t, 120)).toBe(feedIn);
  });

  test("§51 triggers strictly below zero — a slot at exactly 0.00 still pays", () => {
    const t = tariff({
      export: { mode: "spot", feedInPerKwh: feedIn, spot: { marketingModel: "eegFeedIn" } },
    });
    expect(exportPriceForSlot(t, 0)).toBe(feedIn);
  });

  test("direct marketing pays the market less the fee, and can be negative", () => {
    const t = tariff({
      export: {
        mode: "spot",
        feedInPerKwh: feedIn,
        spot: { marketingModel: "direktvermarktung", managementFeePerKwh: 0.004 },
      },
    });
    expect(exportPriceForSlot(t, 120)).toBeCloseTo(0.12 - 0.004, 10);
    // A negative slot means the plant pays to export — the case where curtailing
    // is worth real money rather than merely harmless.
    expect(exportPriceForSlot(t, -50)).toBeCloseTo(-0.05 - 0.004, 10);
  });
});

describe("importPriceAt", () => {
  const bands = [{ name: "Night", pricePerKwh: 0.21, startHour: 22, endHour: 6 }];

  test("static mode uses the bands and ignores the market price", () => {
    const t = tariff({ import: { mode: "static", defaultPricePerKwh: 0.35, bands } });
    expect(importPriceAt(t, -50, 23, 3)).toBe(0.21);
    expect(importPriceAt(t, -50, 12, 3)).toBe(0.35);
  });

  test("spot mode lands the market price", () => {
    const t = tariff({
      import: {
        mode: "spot",
        defaultPricePerKwh: 0.35,
        bands,
        spot: { gridFeesPerKwh: 0.1, vatPercent: 19 },
      },
    });
    expect(importPriceAt(t, 180, 12, 3)).toBeCloseTo((0.18 + 0.1) * 1.19, 10);
  });

  test("an unknown slot price falls back to the bands, never to zero", () => {
    // Under a spot tariff a 0 would read as "electricity was free that hour".
    const t = tariff({ import: { mode: "spot", defaultPricePerKwh: 0.35, bands } });
    expect(importPriceAt(t, null, 12, 3)).toBe(0.35);
    expect(importPriceAt(t, null, 23, 3)).toBe(0.21);
  });
});
