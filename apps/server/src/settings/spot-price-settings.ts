/**
 * Day-ahead price source config (provider + bidding zone), cached in memory and
 * invalidated on write. Persisted via the shared `app_settings` accessor.
 * Deliberately separate from the tariff: this is the feed, not the economics.
 */

import {
  SPOT_PRICE_KEY,
  defaultSpotPriceConfig,
  spotPriceConfigSchema,
} from "@SunReye/db/spot-price-config";
import { cachedSetting } from "./app-settings";

const spotPrices = cachedSetting(SPOT_PRICE_KEY, spotPriceConfigSchema, defaultSpotPriceConfig);

export const getSpotPriceConfig = spotPrices.get;
export const setSpotPriceConfig = spotPrices.set;
