// The savings sheet's facts (ADR 12, 21): what the plant has saved since installation, and how far
// that pays the investment back. Pure.
import type { Payback } from "../api/tariff.ts";
import { paybackShare, reachedYear } from "../history/payback.ts";
import { m } from "../paraglide/messages.js";
import type { Fact } from "./figures.ts";

/** Euros to the cent below 100, whole above, as the range's money reads. */
const euros = (label: string, value: number): Fact => ({
  label,
  value,
  unit: "€",
  digits: Math.abs(value) < 100 ? 2 : 0,
});

/** The savings since installation, the share of the investment they pay and the year they reach it. */
export function paybackFacts(p: Payback): Fact[] {
  const saved = euros(m.detail_since_install(), p.savings);
  const share = paybackShare(p);

  if (share === null) return [saved, { label: m.stats_payback(), text: m.detail_no_investment() }];

  const year = reachedYear(p);
  const paid: Fact = { label: m.stats_payback(), value: share * 100, unit: "%", digits: 0 };

  return year === null
    ? [saved, paid]
    : [saved, paid, { label: m.detail_payback_reached(), text: String(year) }];
}
