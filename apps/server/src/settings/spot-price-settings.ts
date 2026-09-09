/**
 * Day-ahead price source config — the feed's own settings from `app_settings`,
 * the bidding ZONE from `plants.bidding_zone`.
 *
 * The zone moved because it is a fact about where the plant settles, not a
 * preference about the fetch job: it is what a second plant would need its own
 * of, and it belongs beside the tariff reference. `enabled` and `provider`
 * describe the job and stayed.
 *
 * The shape ({@link SpotPriceConfig}) is unchanged, so the cost engine, the
 * statistics page and the price job read exactly what they always did. The 1.x
 * zone is carried over by provisioning, which seeds the column when it creates
 * the plant.
 */

import { defaultSpotPricePrefs, spotPricePrefsSchema } from "@SunReye/db/plant-facts";
import {
  SPOT_PRICE_KEY,
  type SpotPriceConfig,
  defaultSpotPriceConfig,
  spotPriceConfigSchema,
} from "@SunReye/db/spot-price-config";

import { cachedSetting } from "./app-settings";
import { plantFacts } from "./plant-facts-instance";

const prefs = cachedSetting(SPOT_PRICE_KEY, spotPricePrefsSchema, defaultSpotPricePrefs);

export async function getSpotPriceConfig(): Promise<SpotPriceConfig> {
  const [stored, plant] = await Promise.all([prefs.get(), plantFacts.plant()]);
  return {
    ...stored,
    // A plant with no zone yet reads as the schema's default market rather than
    // as an empty string: `spotPricesReady` gates on a non-empty zone, and an
    // empty one would silently disable a feed the operator had enabled.
    zone: plant.biddingZone ?? defaultSpotPriceConfig.zone,
  };
}

export async function setSpotPriceConfig(input: unknown): Promise<SpotPriceConfig> {
  const config = spotPriceConfigSchema.parse(input);
  await prefs.set({ enabled: config.enabled, provider: config.provider });
  await plantFacts.patch({ biddingZone: config.zone });
  return config;
}
