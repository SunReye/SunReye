// How far the savings have paid the investment back (ADR 12).
import type { Payback } from "../api/tariff.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { civil, dayOfIso } from "../range/calendar.ts";
import { money, num } from "../range/format.ts";
import type { TrendRow } from "./trend.ts";

/** 0 to 1; null without an investment. */
export function paybackShare(p: Payback): number | null {
  const investment = p.investment ?? null;

  if (investment === null || investment <= 0) return null;

  return Math.min(1, Math.max(0, p.savings / investment));
}

/** The payback tab's words; null without an investment. */
export function paybackText(p: Payback, loading: boolean) {
  const share = paybackShare(p);
  const investment = p.investment ?? null;

  if (share === null || investment === null) return null;

  const reached = p.reached ?? null;
  const pace = p.pace ?? null;

  return {
    saved: loading ? "–" : money(p.savings),
    of: m.stats_payback_of({ investment: money(investment) }),
    share: loading ? "–" : `${num(share * 100)} %`,
    progress: loading ? 0 : share * 100,
    forecast: forecast(p, reached, pace),
  };
}

const MARK = "\u0000";

/** The pace sentence around its month, which is set apart; a wait or done without a date. */
function forecast(p: Payback, reached: string | null, pace: number | null) {
  if ((p.remaining ?? 0) <= 0) return { before: m.stats_payback_done(), month: "", after: "" };

  if (reached === null || pace === null)
    return { before: m.stats_payback_wait(), month: "", after: "" };

  const [before = "", after = ""] = m
    .stats_payback_pace({ pace: money(pace), month: MARK })
    .split(MARK);

  const month = new Intl.DateTimeFormat(getLocale(), {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(civil(dayOfIso(reached)));

  return { before, month, after };
}

/** The year the savings reach the investment, for the card; null without a forecast. */
export const reachedYear = (p: Payback): number | null =>
  p.reached === null || p.reached === undefined
    ? null
    : civil(dayOfIso(p.reached)).getUTCFullYear();

/** The savings summed by month, then a dashed line at the same pace up to the investment. */
export function paybackRows(p: Payback): TrendRow[] {
  const months = p.months;
  const reached = p.reached ?? null;

  const rows: TrendRow[] = months.map((pt, i) => ({
    x: civil(dayOfIso(pt.date)),
    values: {
      saved: pt.saved,
      projected: i === months.length - 1 && reached !== null ? pt.saved : null,
    },
  }));

  const investment = p.investment ?? null;

  if (reached !== null && investment !== null)
    rows.push({ x: civil(dayOfIso(reached)), values: { saved: null, projected: investment } });

  return rows;
}
