/**
 * Investment config (what the plant cost, when it went live), cached in memory
 * and invalidated on write. Persisted via the shared `app_settings` accessor.
 */

import { INVESTMENT_KEY, defaultInvestment, investmentConfigSchema } from "@SunReye/db/investment";
import { cachedSetting } from "./app-settings";

const investment = cachedSetting(INVESTMENT_KEY, investmentConfigSchema, defaultInvestment);

/** Active investment config, "not configured" (0, no date) when unset. */
export const getInvestment = investment.get;

/** Validate and persist the investment config (upsert), refreshing the cache. */
export const setInvestment = investment.set;
