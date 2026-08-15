/**
 * Day-ahead spot-price wire shapes shared by the server and the web app.
 *
 * These are the definition site: the server's `prices/` and `statistics/`
 * modules import them back, and the web price/statistics views import them from
 * `@SunReye/contracts/prices`. Type-only — no runtime tail (see AGENTS.md).
 *
 * A recurring rule these shapes encode: **an absent slot means _unknown_, never
 * 0 EUR/MWh.** Coverage/availability say how complete a window is; a `0`
 * negative-slot count for a day that is `"missing"` means *unknown*, not "none".
 */

export type SlotCoverage = "complete" | "partial" | "missing";

/** Whether the automation may plan on this slice, and how far. */
export type SpotAvailability = "ok" | "today-only" | "none";

/** One priced market slot, as the API and the automations see it. */
export interface SpotPricePoint {
  /** Market-local wall clock, `YYYY-MM-DDTHH:mm` (for labels only). */
  time: string;
  /** Slot start as an absolute instant — what all matching is done on. */
  startMs: number;
  /** Nominal width of the *source* slot, minutes (60 ⇒ quarter-hours unresolved). */
  minutes: number;
  /** Wholesale price, EUR/MWh. Signed. */
  eurPerMwh: number;
  /** `eurPerMwh < 0` — the §51 zero-remuneration trigger. Strictly below zero. */
  negative: boolean;
}

/**
 * A window of priced slots plus how complete it is.
 *
 * Structurally a superset of the forecast's `ForecastSlice`, deliberately: the
 * automation walks both with the same slot geometry. `utcOffsetSeconds` is the
 * *market's* offset and must never be taken from the forecast.
 */
export interface SpotSlice {
  zone: string;
  series: SpotPricePoint[];
  stepMinutes: number;
  utcOffsetSeconds: number;
  coverage: { today: SlotCoverage; tomorrow: SlotCoverage };
  availability: SpotAvailability;
}

/**
 * A market slot with the money applied: what a kWh imported then costs, and what
 * a kWh exported then earns, both under the active tariff.
 */
export type PricedSlot = SpotPricePoint & {
  /** Landed import price for the slot, currency-major per kWh. */
  importPerKwh: number;
  /** Export remuneration for the slot, currency-major per kWh. Can be 0 (§51). */
  exportPerKwh: number;
};

/** One priced slot as the API returns it. */
export interface SpotPriceView {
  provider: string;
  zone: string;
  /** Credit line the UI must render (CC BY 4.0 for the default source). */
  attribution: string | null;
  /**
   * Coarsest source resolution present, minutes. 60 means at least some slots
   * came from an hourly source, so a negative quarter-hour inside a positive hour
   * could not be resolved.
   */
  resolutionMinutes: number;
  utcOffsetSeconds: number;
  coverage: SpotSlice["coverage"];
  availability: SpotSlice["availability"];
  series: PricedSlot[];
  /** Cheapest/priciest slot of the whole slice, EUR/MWh; null when empty. */
  extremes: { minEurPerMwh: number; maxEurPerMwh: number } | null;
  /**
   * Count of negative slots per day. Read together with `coverage` — a 0 for a
   * day that is `"missing"` means *unknown*, not "none".
   */
  negativeSlots: { today: number; tomorrow: number };
}

/** Window-wide price summary; null when the window holds no stored slot. */
export interface SpotSummary {
  avgEurPerMwh: number;
  minEurPerMwh: number;
  maxEurPerMwh: number;
  slots: number;
  negativeSlots: number;
  /** Wall-clock hours that cleared below zero, from the slot widths — the
   *  headline figure, since slot counts differ between 15- and 60-minute days. */
  negativeHours: number;
}

/** One day of the price series returned to the client. */
export interface SpotDailyStat {
  date: string;
  avgEurPerMwh: number;
  minEurPerMwh: number;
  maxEurPerMwh: number;
  slots: number;
  negativeSlots: number;
}

/** A contiguous run of below-zero market slots. */
export interface NegativeWindow {
  start: string;
  end: string;
  minEurPerMwh: number;
  slots: number;
}

/**
 * How the household's import timing compares with the market. Only the weighted
 * side lives here: the market average it is read against is the window's
 * {@link SpotSummary.avgEurPerMwh}, so the screen states one market figure
 * rather than two that differ in weighting and coverage.
 */
export interface PaidVsMarket {
  importKwh: number;
  /** Σ(import·price) / Σ import over priced hours. Below the market average
   *  means the plant imported in the cheaper hours. */
  importWeightedAvgEurPerMwh: number;
  /** Share of imported kWh that fell in an hour with a known market price. */
  coverage: number;
}

/** What the window's import would have cost under each import model. */
export interface SpotWhatIf {
  /** Priced from the tariff's time-of-use bands. */
  staticCost: number;
  /** Priced from the market, landed through the tariff's spot components. */
  spotCost: number;
  /** `spotCost − staticCost`: negative means spot would have been cheaper. */
  delta: number;
  /**
   * Whether `import.spot` carries any real component. With markup, grid fees,
   * levies and VAT all at zero the "spot cost" is bare wholesale and grossly
   * understates a bill — the UI must caption the figure accordingly rather than
   * present it as a quote.
   */
  spotComponentsConfigured: boolean;
  /** Share of imported kWh that had a market price. */
  coverage: number;
}

/** Response of `GET /api/statistics/prices`. */
export interface SpotStats {
  zone: string;
  currency: string;
  from: string;
  to: string;
  summary: SpotSummary | null;
  daily: SpotDailyStat[];
  negativeWindows: NegativeWindow[];
  /** True when the raw pass covered less than the requested window, so the
   *  negative-window list starts later than `from`. */
  negativeWindowsTruncated: boolean;
  paidVsMarket: PaidVsMarket | null;
  whatIf: SpotWhatIf | null;
}
