// The core's daily costs laid onto a range's bands (ADR 12): savings split into the import they
// avoided and the feed-in pay, and the import bill.
import type { CostDays } from "../api/tariff";
import type { Edge } from "../range/edges.ts";
import { spread, type Fill } from "../range/fill.ts";

type Money = Readonly<CostDays["total"]>;

const NONE: Money = { paid: 0, earned: 0, saved: 0 };

/** Savings above the baseline, avoided import first; the import bill below it. */
export function split(money?: Readonly<CostDays["total"]>) {
  const { paid, earned, saved } = money ?? NONE;

  return { up: [Math.max(0, saved - earned), earned], down: [paid] };
}

/** Each band's share of the days it overlaps. */
export function costBands(
  days: readonly Readonly<CostDays["days"][number]>[],
  spans: readonly (readonly [number, number])[],
  now: number,
): (edge: Edge, index: number) => Fill {
  const spanned: readonly Readonly<Money & { start: number; end: number }>[] = days.map((d) => ({
    paid: d.paid,
    earned: d.earned,
    saved: d.saved,
    start: Date.parse(d.start),
    end: Date.parse(d.end),
  }));

  return (_, i) => {
    const [a, b] = spans[i] ?? [0, 0];
    const part = (key: keyof Money) => spread(spanned, a, b, (d) => d[key]).sum;

    return {
      ...split({ paid: part("paid"), earned: part("earned"), saved: part("saved") }),
      covered: spread(spanned, a, b, () => 0).covered,
      elapsed: Math.max(0, Math.min(b, now) - a),
    };
  };
}
