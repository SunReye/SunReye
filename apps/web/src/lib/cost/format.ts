// Locale-aware formatters for cost figures, extracted from the costs page so
// charts and tile registries share one definition. A factory (rather than
// free functions) because every formatter is pinned to the breakdown's
// currency: call `costFormatters(cost?.currency)` per fetched payload.

export interface CostFormatters {
  /** Currency amount at the locale's default precision (2dp for EUR). */
  money: (v: number) => string;
  /** Unit price: 2–3 fraction digits so sub-cent rates stay visible. */
  price: (v: number) => string;
  /** Energy figure with unit, at most 1 fraction digit. */
  kwh: (v: number) => string;
  /** Ratio 0..1 as a whole percent; em-dash when the server reports null. */
  pct: (v: number | null) => string;
}

/** Build the formatter set for one currency; `undefined` falls back to EUR. */
export function costFormatters(currency?: string): CostFormatters {
  const cur = currency ?? "EUR";
  return {
    money: (v) => new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(v),
    price: (v) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: cur,
        minimumFractionDigits: 2,
        maximumFractionDigits: 3,
      }).format(v),
    kwh: (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`,
    pct: (v) => (v === null ? "—" : `${Math.round(v * 100)}%`),
  };
}
