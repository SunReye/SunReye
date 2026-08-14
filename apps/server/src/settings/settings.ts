/**
 * Tariff settings, cached in memory and invalidated on write so hot paths (the
 * cost engine) don't hit the database per request. Persisted via the shared
 * `app_settings` accessor.
 */

import {
  TARIFF_KEY,
  type TariffConfig,
  defaultTariff,
  tariffConfigSchema,
} from "@SunReye/db/tariff";
import { readSetting, writeSetting } from "./app-settings";

let tariffCache: TariffConfig | null = null;

/** Active tariff config, falling back to neutral defaults when unset/invalid. */
export async function getTariff(): Promise<TariffConfig> {
  tariffCache ??= await readSetting(TARIFF_KEY, tariffConfigSchema, defaultTariff);
  return tariffCache;
}

/** Validate and persist the tariff config (upsert), refreshing the cache. */
export async function setTariff(input: unknown): Promise<TariffConfig> {
  const config = tariffConfigSchema.parse(input);
  await writeSetting(TARIFF_KEY, config);
  tariffCache = config;
  return config;
}
