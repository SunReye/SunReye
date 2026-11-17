// The core's daily costs laid onto a range's bands (ADR 12): savings split into the import they
// avoided and the feed-in pay, and what was paid: the import bill and the standing charge.
import type { CostDays } from "../api/tariff";
import type { Edge } from "../range/edges.ts";
import { spread, type Fill } from "../range/fill.ts";

type Money = Readonly<CostDays["total"]>;

const NONE: Money = { paid: 0, earned: 0, saved: 0, standing: 0 };

/** Savings above the baseline, avoided import first; the import bill and the standing charge below. */
export function split(money?: Readonly<CostDays["total"]>) {
  const { paid, earned, saved, standing } = money ?? NONE;

  return { up: [Math.max(0, saved - earned), earned], down: [paid, standing] };
}

/** What was saved, avoided import first, above the baseline; the import it could not avoid below. */
export function savingsSplit(money?: Readonly<CostDays["total"]>) {
  const { up, down } = split(money);

  return { up, down: down.slice(0, 1) };
}

/** Each band's share of the days it overlaps, its sides as `sides` splits them. */
export function costBands(
  days: readonly Readonly<CostDays["days"][number]>[],
  spans: readonly (readonly [number, number])[],
  now: number,
  sides: typeof split = split,
): (edge: Edge, index: number) => Fill {
  const spanned: readonly Readonly<Money & { start: number; end: number }>[] = days.map((d) => ({
    paid: d.paid,
    earned: d.earned,
    saved: d.saved,
    standing: d.standing,
    start: Date.parse(d.start),
    end: Date.parse(d.end),
  }));

  return (_, i) => {
    const [a, b] = spans[i] ?? [0, 0];
    const part = (key: keyof Money) => spread(spanned, a, b, (d) => d[key]).sum;

    return {
      ...sides({
        paid: part("paid"),
        earned: part("earned"),
        saved: part("saved"),
        standing: part("standing"),
      }),
      covered: spread(spanned, a, b, () => 0).covered,
      elapsed: Math.max(0, Math.min(b, now) - a),
    };
  };
}
