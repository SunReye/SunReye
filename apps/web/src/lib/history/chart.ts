// The statistics screen's main chart for each question (ADR 21): the range's bands, a diverging
// split around one baseline, and the range's sums for the legend. Pure.
import { m } from "../paraglide/messages.js";
import type { Band, SeriesMeta } from "../range/bands.ts";
import { edges } from "../range/edges.ts";
import { bandsOf } from "../range/fill.ts";
import { kwh, money, num } from "../range/format.ts";
import { hourInstant } from "../range/range.ts";
import { costBands, split } from "../tariff/costs.ts";
import { sumOf, type Sum } from "./flows.ts";
import type { Loaded } from "./stats.svelte.ts";
import type { Metric } from "./view.ts";

export interface Chart {
  readonly bands: Band[];
  readonly up: SeriesMeta[];
  readonly down: SeriesMeta[];
  readonly groups: [string, string];
  readonly summary: { readonly up: number[]; readonly down: number[] };
  readonly fmt: (v: number) => string;
  readonly unit: string;
  readonly max: number | undefined;
  readonly label: string;
  /** The range each band opens, by index. */
  readonly drills: Loaded["list"];
}

const share = (v: number, s: Sum) =>
  s.consumption > 0 ? (Math.max(0, v) / s.consumption) * 100 : 0;

/** Where the house load came from: the plant directly, the battery, the grid. */
function sources(s: Sum, battery: boolean): number[] {
  const own = Math.max(0, s.consumption - s.purchase);

  if (!battery) return [share(own, s), share(s.purchase, s)];

  const stored = Math.min(s.discharge, own);

  return [share(own - stored, s), share(stored, s), share(s.purchase, s)];
}

function flows(got: Loaded, metric: "energy" | "autarky"): Chart {
  const battery = got.sum.discharge > 0.05;
  const energy = metric === "energy";
  const upOf = (s: Sum) => (energy ? [s.selfUsed, s.feedIn] : sources(s, battery));
  const downOf = (s: Sum) => (energy ? [s.selfCovered, s.purchase] : []);

  const bands = bandsOf(got.list, (_, i) => {
    const [a, b] = got.spans[i]!;
    const s = sumOf(got.plant, a, b);

    return {
      up: upOf(s),
      down: downOf(s),
      covered: s.covered,
      elapsed: Math.max(0, Math.min(b, got.now) - a),
    };
  });

  const solar = { label: m.stats_self_used(), colour: "var(--e-solar)" };

  return {
    bands,
    up: energy
      ? [solar, { label: m.stats_fed_in(), colour: "var(--e-export)" }]
      : [
          { label: m.stats_from_pv(), colour: "var(--e-solar)" },
          ...(battery ? [{ label: m.stats_from_battery(), colour: "var(--e-battery)" }] : []),
          { label: m.stats_from_grid(), colour: "var(--e-import)" },
        ],
    down: energy
      ? [
          { label: m.stats_self_covered(), colour: "var(--e-house)" },
          { label: m.stats_bought(), colour: "var(--e-import)" },
        ]
      : [],
    groups: energy ? [m.stats_production(), m.stats_consumption()] : ["", ""],
    summary: { up: upOf(got.sum), down: downOf(got.sum) },
    fmt: energy ? kwh : (v) => `${num(v)} %`,
    unit: energy ? "kWh" : "%",
    max: energy ? undefined : 100,
    label: energy ? m.stats_chart_energy() : m.stats_chart_autarky(),
    drills: got.list,
  };
}

/** Money comes by the plant-local day, so a day is its finest band. */
function costs(got: Loaded): Chart {
  const list = edges(got.cal, got.range, "day");
  const ms = (t: number) => hourInstant(got.zone, t).getTime();
  const spans = list.map((e) => [ms(e.t0), ms(e.t1)] as const);

  return {
    bands: bandsOf(list, costBands(got.days ?? [], spans, got.now)),
    up: [
      { label: m.stats_avoided(), colour: "var(--e-solar)" },
      { label: m.stats_feed_in_pay(), colour: "var(--e-export)" },
    ],
    down: [{ label: m.stats_import_cost(), colour: "var(--e-import)" }],
    groups: [m.stats_savings(), m.stats_costs()],
    summary: split(got.money ?? undefined),
    fmt: money,
    unit: "€",
    max: undefined,
    label: m.stats_chart_money(),
    drills: list,
  };
}

export function chartOf(metric: Metric, got: Loaded): Chart {
  if (metric === "money") return costs(got);

  return flows(got, metric === "autarky" ? "autarky" : "energy");
}
