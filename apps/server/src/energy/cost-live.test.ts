/**
 * What `computeCost` resolves LIVE when a caller hands it no context and no
 * price source: the plant zone, the tariff, and the stored day-ahead slots of
 * the plant's configured bidding zone.
 *
 * `./cost.test.ts` passes every one of those in and so never reaches them. The
 * settings and the price store are stubbed here, spread over the real modules
 * and handed back by value in afterAll, so nothing leaks into a later file.
 */
import type { HourEnergy } from "@SunReye/contracts/energy";
import { tariffConfigSchema } from "@SunReye/db/tariff";
import type { InverterProfile } from "@SunReye/inverter-core";
import { afterAll, describe, expect, mock, test } from "bun:test";

import type { RollupReader } from "./rollup-reader";

const realDisplay = await import("../settings/display-settings");
const realDisplayExports = { ...realDisplay };
const realSettings = await import("../settings/settings");
const realSettingsExports = { ...realSettings };
const realSpotSettings = await import("../settings/spot-price-settings");
const realSpotSettingsExports = { ...realSpotSettings };
const realSpotPrice = await import("@SunReye/db/spot-price");
const realSpotPriceExports = { ...realSpotPrice };

afterAll(() => {
  mock.module("../settings/display-settings", () => ({ ...realDisplayExports }));
  mock.module("../settings/settings", () => ({ ...realSettingsExports }));
  mock.module("../settings/spot-price-settings", () => ({ ...realSpotSettingsExports }));
  mock.module("@SunReye/db/spot-price", () => ({ ...realSpotPriceExports }));
});

const eegTariff = tariffConfigSchema.parse({
  currency: "EUR",
  standingChargeMonthly: 0,
  import: { defaultPricePerKwh: 0.3 },
  export: { mode: "spot", feedInPerKwh: 0.08, spot: { marketingModel: "eegFeedIn" } },
});

const getPlantTimeZone = mock(async () => "Asia/Kolkata");
const getTariff = mock(async () => eegTariff);
const getSpotPriceConfig = mock(
  async () => ({ zone: "AT" }) as Awaited<ReturnType<typeof realSpotSettings.getSpotPriceConfig>>,
);
const getSpotPrices = mock(async (_zone: string, from: Date) =>
  [0, 1, 2, 3].map((i) => ({
    slotStart: new Date(from.getTime() + (13.5 * 60 + i * 15) * 60_000),
    eurPerMwh: -5,
  })),
);

mock.module("../settings/display-settings", () => ({ ...realDisplay, getPlantTimeZone }));
mock.module("../settings/settings", () => ({ ...realSettings, getTariff }));
mock.module("../settings/spot-price-settings", () => ({ ...realSpotSettings, getSpotPriceConfig }));
mock.module("@SunReye/db/spot-price", () => ({ ...realSpotPrice, getSpotPrices }));

const { computeCost } = await import("./cost");

const profile = {
  id: "inv-1",
  metrics: [{ role: "grid.energy.exported.total", key: "exp" }],
} as unknown as InverterProfile;

describe("computeCost with nothing handed in", () => {
  test("prices in the plant's zone and tariff, against the configured zone's stored slots", async () => {
    // 18:30Z is Kolkata midnight; the four negative slots cover 08:00Z–09:00Z.
    const from = new Date("2024-06-14T18:30:00Z");
    const to = new Date("2024-06-15T18:30:00Z");
    const hour: HourEnergy = {
      time: new Date("2024-06-15T08:00:00Z"),
      import: 0,
      export: 4,
      load: 0,
      production: 0,
      batteryDischarge: 0,
      batteryCharge: 0,
    };
    const reader: RollupReader = {
      bucketEnergy: async () => [hour],
      counterDeltaMatrix: async () => ({ rows: [], fieldByKey: new Map(), periods: [] }),
    };

    const totals = await computeCost(profile, { from, to }, { reader, liveSample: () => null });

    expect(getPlantTimeZone).toHaveBeenCalled();
    expect(getTariff).toHaveBeenCalled();
    expect(getSpotPrices.mock.calls[0]?.[0]).toBe("AT");
    expect(totals.zeroValueExportKwh).toBeCloseTo(4, 10);
    expect(totals.exportEarnings).toBe(0);
  });
});
