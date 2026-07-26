/**
 * Tariff configuration — the economic model applied to energy flows to turn
 * kWh into money. Stored in `app_settings` under the key {@link TARIFF_KEY} and
 * validated with {@link tariffConfigSchema} on read/write. Shared by the server
 * (cost engine) and the web app (settings form), so the shape lives here.
 */

import { z } from "zod";

/** `app_settings.key` under which the tariff config is stored. */
export const TARIFF_KEY = "tariff";

/**
 * A time-of-use import band. Applies on the hours `[startHour, endHour)` in
 * 24h local time; a band that wraps midnight (e.g. 22→6) is allowed. `days`
 * restricts it to given ISO weekdays (1=Mon … 7=Sun); omitted = every day.
 * Hours not covered by any band fall back to `import.defaultPricePerKwh`.
 */
const tariffBandSchema = z.object({
  name: z.string().min(1),
  pricePerKwh: z.number().nonnegative(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  days: z.array(z.number().int().min(1).max(7)).nonempty().optional(),
});
export type TariffBand = z.infer<typeof tariffBandSchema>;

export const tariffConfigSchema = z.object({
  /** ISO 4217 currency code used for formatting (e.g. "EUR", "USD"). */
  currency: z.string().length(3).default("EUR"),
  /** Fixed monthly supply charge, prorated across the reporting range. */
  standingChargeMonthly: z.number().nonnegative().default(0),
  import: z
    .object({
      /** Price for any hour not matched by a band. */
      defaultPricePerKwh: z.number().nonnegative().default(0),
      /** Optional time-of-use bands; empty = a single flat rate. */
      bands: z.array(tariffBandSchema).default([]),
    })
    .default({ defaultPricePerKwh: 0, bands: [] }),
  export: z
    .object({
      /** Flat feed-in / export rate paid per kWh sold back to the grid. */
      feedInPerKwh: z.number().nonnegative().default(0),
    })
    .default({ feedInPerKwh: 0 }),
});
export type TariffConfig = z.infer<typeof tariffConfigSchema>;

/** Neutral defaults (everything zero) used before a tariff is configured. */
export const defaultTariff: TariffConfig = tariffConfigSchema.parse({});

/**
 * The import band applying at a given local hour/weekday (first match), or
 * `null` when none apply (the default rate is used). `hour` is 0–23,
 * `isoWeekday` is 1 (Mon)–7 (Sun).
 */
export function importBandForHour(
  tariff: TariffConfig,
  hour: number,
  isoWeekday: number,
): TariffBand | null {
  for (const band of tariff.import.bands) {
    if (band.days && !band.days.includes(isoWeekday)) continue;
    const inBand =
      band.startHour < band.endHour
        ? hour >= band.startHour && hour < band.endHour // same-day window
        : hour >= band.startHour || hour < band.endHour; // wraps midnight
    if (inBand) return band;
  }
  return null;
}

/** Import price for a given local hour/weekday: matching band, else default. */
export function importPriceForHour(tariff: TariffConfig, hour: number, isoWeekday: number): number {
  return (
    importBandForHour(tariff, hour, isoWeekday)?.pricePerKwh ?? tariff.import.defaultPricePerKwh
  );
}
