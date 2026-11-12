// What a trend chart draws: rows over plant-local days and the series read from them.
export interface TrendSeries {
  readonly key: string;
  readonly label: string;
  readonly colour: string;
  readonly kind: "line" | "dashed" | "area" | "points";
}

/** `x` is a civil day at UTC midnight; `values` by series key, null where a series has none. */
export interface TrendRow {
  readonly x: Readonly<Date>;
  readonly values: Readonly<Record<string, number | null>>;
}

/** A horizontal reference line, such as the investment or the nameplate capacity. */
export interface TrendRule {
  readonly y: number;
  readonly label: string;
}

export const isValue = (v: number | null | undefined): v is number => v !== null && v !== undefined;

export const valueOf =
  (key: string) =>
  (d: TrendRow): number | null =>
    d.values[key] ?? null;

export const defined =
  (key: string) =>
  (d: TrendRow): boolean =>
    isValue(d.values[key]);
