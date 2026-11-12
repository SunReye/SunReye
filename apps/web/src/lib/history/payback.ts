// How far the savings have paid the investment back (ADR 12).
import type { Payback } from "../api/tariff.ts";
import { m } from "../paraglide/messages.js";
import { money, num } from "../range/format.ts";

/** 0 to 1; null without an investment. */
export function paybackShare(p: Readonly<Payback>): number | null {
  const investment = p.investment ?? null;

  if (investment === null || investment <= 0) return null;

  return Math.min(1, Math.max(0, p.savings / investment));
}

/** The payback tab's words; null without an investment. */
export function paybackText(p: Readonly<Payback>, loading: boolean) {
  const share = paybackShare(p);
  const investment = p.investment ?? null;

  if (share === null || investment === null) return null;

  const remaining = p.remaining ?? 0;

  return {
    saved: loading ? "–" : money(p.savings),
    of: m.stats_payback_of({ investment: money(investment) }),
    share: loading ? "–" : `${num(share * 100)} %`,
    progress: loading ? 0 : share * 100,
    left:
      remaining > 0
        ? m.stats_payback_left({ remaining: money(remaining) })
        : m.stats_payback_done(),
  };
}
