// The core's daily costs laid onto a range's bands (ADR 12): savings split into the import they
// avoided and the feed-in pay, and what was paid: the import bill and the standing charge.
import type { CostDays } from "../api/tariff";
import { flowColour } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import type { SeriesMeta } from "../range/bands.ts";
import type { Edge } from "../range/edges.ts";
import { bandsOf, spread, type Fill } from "../range/fill.ts";
import type { Loaded } from "../range/range-data.svelte.ts";

type Money = Readonly<CostDays["total"]>;

const NONE: Money = { paid: 0, earned: 0, saved: 0, standing: 0 };

/** Savings above the baseline, avoided import first; the import bill and the standing charge below. */
export function split(money?: Readonly<CostDays["total"]>) {
  const { paid, earned, saved, standing } = money ?? NONE;

  return { up: [Math.max(0, saved - earned), earned], down: [paid, standing] };
}

/** What was saved, avoided import first, above the baseline; the import it could not avoid below. */
function savingsSplit(money?: Readonly<CostDays["total"]>) {
  const { up, down } = split(money);

  return { up, down: down.slice(0, 1) };
}

/** How a chart lays the days out: its sides, what is below the baseline and its name. */
export interface CostChart {
  readonly sides: typeof split;
  readonly up: SeriesMeta[];
  readonly down: SeriesMeta[];
  readonly groups: [string, string];
  readonly label: string;
  /** A day reads by the hour. */
  readonly hourly: boolean;
}

const up = () => [
  { label: m.tariff_avoided(), colour: flowColour("solar") },
  { label: m.tariff_feed_in_pay(), colour: flowColour("export") },
];

/** The Tariff screen's savings and costs, and the savings sheet's savings over what was paid. */
export const COST_CHARTS = {
  costs: (): CostChart => ({
    sides: split,
    up: up(),
    down: [
      { label: m.tariff_import_cost(), colour: flowColour("import") },
      { label: m.tariff_standing(), colour: flowColour("house") },
    ],
    groups: [m.tariff_saving_group(), m.tariff_cost_group()],
    label: m.tariff_chart(),
    hourly: false,
  }),
  savings: (): CostChart => ({
    sides: savingsSplit,
    up: up(),
    down: [{ label: m.detail_unavoided(), colour: flowColour("import") }],
    groups: [m.tariff_saving_group(), m.detail_paid()],
    label: m.detail_savings_chart(),
    hourly: true,
  }),
};

/** One read of costs as the chart draws it: its bands and totals. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- a load is never written.
export function costsView(got: Readonly<Loaded<CostDays>>, laid: Readonly<CostChart>) {
  return {
    bands: bandsOf(got.list, costBands(got.data.days, got.spans, got.now, laid.sides)),
    total: laid.sides(got.data.total),
  };
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
