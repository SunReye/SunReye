/**
 * Tariff configuration — the economic model applied to energy flows to turn
 * kWh into money. Stored in `app_settings` under the key {@link TARIFF_KEY} and
 * validated with {@link tariffConfigSchema} on read/write. Shared by the server
 * (cost engine) and the web app (settings form), so the shape lives here.
 *
 * ## The parse must stay total
 *
 * `readSetting` validates with `safeParse` and **falls back to the default when
 * it fails**. So a schema change that can reject an already-stored row resets a
 * user's tariff to zeros; the rejected row is warned about and kept under
 * `<key>:rejected`, but nobody notices the reset until a cost figure looks
 * wrong.
 *
 * That is why the market-price support below is a **flat tagged record** — a
 * `mode` enum with a default, every sub-object always present and always
 * defaulted — rather than a `z.discriminatedUnion`. A union cannot default a
 * missing discriminant, so every row written before this change would match no
 * branch and fail. The mode is discriminated in the *resolvers*, not in Zod, and
 * `tariff.test.ts` pins that a pre-change blob still parses intact.
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
  // Signed: a rebate can make a band's effective energy price negative, and a
  // spot-linked plant's fallback band should be the same kind of number as the
  // landed price it stands in for.
  pricePerKwh: z.number(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  days: z.array(z.number().int().min(1).max(7)).nonempty().optional(),
});
export type TariffBand = z.infer<typeof tariffBandSchema>;

/**
 * Turning a wholesale price into what a household actually pays. Every
 * component is per kWh in the tariff's currency; the wholesale part arrives
 * separately because it changes every quarter-hour.
 */
const spotImportSchema = z.object({
  /** Supplier margin. **Signed** — introductory rebates exist. */
  supplierMarkupPerKwh: z.number().default(0),
  /** Grid fees, metering and concession levy. */
  gridFeesPerKwh: z.number().nonnegative().default(0),
  /** Taxes and levies (Stromsteuer, KWKG, §19, offshore). */
  leviesPerKwh: z.number().nonnegative().default(0),
  /** VAT in % applied to the sum of the above (19 in DE; 0 disables). */
  vatPercent: z.number().min(0).max(100).default(0),
  /** Floor the landed price at 0 — some suppliers never pay you to consume. */
  clampToZero: z.boolean().default(false),
});
export type SpotImportPricing = z.infer<typeof spotImportSchema>;

/** How exported energy is remunerated when the market price is known. */
const spotExportSchema = z.object({
  /**
   * - `none` — ignore the market; export always pays `feedInPerKwh`.
   * - `eegFeedIn` — **§51 EEG**: a plant commissioned after 2025-02-25 is paid
   *   *nothing* for a quarter-hour whose day-ahead price was negative, and the
   *   normal feed-in tariff otherwise.
   * - `direktvermarktung` — paid the market price less a management fee, which
   *   can be negative: in a negative slot you *pay* to export.
   */
  marketingModel: z.enum(["none", "eegFeedIn", "direktvermarktung"]).default("none"),
  /** Direct-marketing management fee, subtracted from the market price. */
  managementFeePerKwh: z.number().nonnegative().default(0),
});

const importTariffSchema = z.object({
  /**
   * `static` prices from the bands below; `spot` prices from the day-ahead market
   * plus {@link spotImportSchema}, falling back to the bands whenever a slot's
   * market price is unknown.
   */
  mode: z.enum(["static", "spot"]).default("static"),
  /** Price for any hour not matched by a band. Signed, like the bands. */
  defaultPricePerKwh: z.number().default(0),
  /** Optional time-of-use bands; empty = a single flat rate. */
  bands: z.array(tariffBandSchema).default([]),
  spot: spotImportSchema.default(spotImportSchema.parse({})),
});

const exportTariffSchema = z.object({
  /** `static` always pays `feedInPerKwh`; `spot` applies the marketing model. */
  mode: z.enum(["static", "spot"]).default("static"),
  /**
   * Flat feed-in / export rate paid per kWh sold back to the grid.
   *
   * Stays non-negative on purpose: a guaranteed EEG tariff is never negative.
   * Negative *remuneration* only arises under direct marketing, where it is
   * computed from the market price rather than stored.
   */
  feedInPerKwh: z.number().nonnegative().default(0),
  spot: spotExportSchema.default(spotExportSchema.parse({})),
});

export const tariffConfigSchema = z.object({
  /** ISO 4217 currency code used for formatting (e.g. "EUR", "USD"). */
  currency: z.string().length(3).default("EUR"),
  /** Fixed monthly supply charge, prorated across the reporting range. */
  standingChargeMonthly: z.number().nonnegative().default(0),
  import: importTariffSchema.default(importTariffSchema.parse({})),
  export: exportTariffSchema.default(exportTariffSchema.parse({})),
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

/**
 * What a household actually pays for a kWh imported at a given wholesale price.
 *
 * Note the VAT applies to the **whole** landed sum including a negative wholesale
 * part — which is what a German invoice does. VATing only the positive components
 * would overstate the bill in exactly the hours this feature is about.
 *
 * Exported for the statistics what-if, which reprices a *static* household's
 * import under spot — there is no `importPriceAt` path for that, since the
 * tariff's own mode says static.
 */
export function landedImportPrice(eurPerMwh: number, s: SpotImportPricing): number {
  const net = eurPerMwh / 1000 + s.supplierMarkupPerKwh + s.gridFeesPerKwh + s.leviesPerKwh;
  const gross = net * (1 + s.vatPercent / 100);
  return s.clampToZero ? Math.max(0, gross) : gross;
}

/**
 * What the plant is paid for a kWh exported in a slot at `eurPerMwh`.
 *
 * The §51 EEG trigger is strictly **below** zero: a slot that clears at exactly
 * 0.00 still pays the normal feed-in tariff.
 */
export function exportPriceForSlot(tariff: TariffConfig, eurPerMwh: number): number {
  const { feedInPerKwh, mode, spot } = tariff.export;
  if (mode !== "spot" || spot.marketingModel === "none") return feedInPerKwh;
  if (spot.marketingModel === "eegFeedIn") return eurPerMwh < 0 ? 0 : feedInPerKwh;
  // Direct marketing: paid the market price less the management fee, so a
  // negative slot means the plant pays to export.
  return eurPerMwh / 1000 - spot.managementFeePerKwh;
}

/**
 * Import price for one instant under either mode.
 *
 * `static` delegates to {@link importPriceForHour} rather than reimplementing
 * band matching, so the band rules exist in exactly one place. A `spot` tariff
 * whose slot price is unknown falls back to the same bands — **never** to zero,
 * which under a spot tariff would read as "electricity was free".
 */
export function importPriceAt(
  tariff: TariffConfig,
  eurPerMwh: number | null,
  hour: number,
  isoWeekday: number,
): number {
  if (tariff.import.mode === "spot" && eurPerMwh !== null) {
    return landedImportPrice(eurPerMwh, tariff.import.spot);
  }
  return importPriceForHour(tariff, hour, isoWeekday);
}
