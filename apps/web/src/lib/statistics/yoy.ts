// Year-over-year folding for the records section: a trailing 24-month monthly
// series arrives as flat period keys, and the chart wants twelve calendar
// months each carrying this year's and last year's figure.

/** One monthly period of whatever metric is being compared. */
export type MonthlyValue = {
  /** Local period key `YYYY-MM`. */
  bucket: string;
  value: number;
};

/** One calendar month, this year against last. */
export type YoyRow = {
  /** 1..12 — January is 1. */
  month: number;
  /** Period key of the current-year month, for axis labelling. */
  bucket: string;
  current: number | null;
  previous: number | null;
};

/**
 * Twelve rows (January…December) of `year` against `year − 1`. Months with no
 * row in the series stay null so the chart can leave the future — and any gap
 * in the history — empty instead of drawing a zero.
 */
export function groupYoy(rows: readonly MonthlyValue[], year: number): YoyRow[] {
  const byBucket = new Map(rows.map((r) => [r.bucket, r.value]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${i + 1}`.padStart(2, "0");
    const bucket = `${year}-${month}`;
    return {
      month: i + 1,
      bucket,
      current: byBucket.get(bucket) ?? null,
      previous: byBucket.get(`${year - 1}-${month}`) ?? null,
    };
  });
}

/** True when there is anything at all to chart. */
export const hasYoyData = (rows: readonly YoyRow[]): boolean =>
  rows.some((r) => r.current !== null || r.previous !== null);
