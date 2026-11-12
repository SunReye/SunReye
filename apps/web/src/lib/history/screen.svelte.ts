// The statistics screen's state (ADR 11, 21): the range and the view in the hash route, what was
// read for them, and how a change of question, tab or range travels.
import { untrack } from "svelte";
import type { Core } from "../api/core.ts";
import { stringRows } from "../analytics/strings.ts";
import type { Travel } from "../range/Pager.svelte";
import { rangeKey } from "../range/range.ts";
import { RangeRoute, type Go } from "../range/route.svelte.ts";
import { readFacts, type Facts } from "./facts.ts";
import type { Note } from "./notes.ts";

export type { Summary } from "./summary.ts";

import { StatsData } from "./stats.svelte.ts";
import { METRICS, tabsOf, viewOf, VIEW_PARAMS, type Metric, type StatsView } from "./view.ts";

export type StatisticsCore = Readonly<
  Pick<
    Core,
    | "timezone"
    | "history"
    | "statistics"
    | "costs"
    | "forecasts"
    | "tariff"
    | "payback"
    | "layout"
    | "capabilities"
    | "moduleTypes"
    | "corrections"
  >
>;

const side = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);

export class Statistics {
  readonly route: RangeRoute;
  readonly data: StatsData;
  facts = $state.raw<Facts | null>(null);

  readonly view: StatsView = $derived(viewOf(this.#params(), this.facts?.battery ?? false));
  /** A primitive, so a view that is only rebuilt does not reload the range. */
  readonly #cmp = $derived(this.view.cmp);

  readonly #shown: { metric: Metric; tab: StatsView["tab"] };

  constructor(input: () => { core: StatisticsCore; params: URLSearchParams; go: Go }) {
    this.route = new RangeRoute(() => input(), 0, VIEW_PARAMS);
    this.data = new StatsData(() => ({ core: input().core, route: this.route, cmp: this.#cmp }));
    this.#shown = untrack(() => ({ metric: this.view.metric, tab: this.view.tab }));

    $effect(() => {
      const core = input().core;
      let live = true;

      const read = async () => {
        const next = await readFacts(core);

        if (live) this.facts = next;
      };

      void read();

      return () => {
        live = false;
      };
    });
  }

  #params(): URLSearchParams {
    const r: RangeRoute = this.route;

    return r.params;
  }

  get today(): number {
    return this.route.place.cal.today;
  }

  /** The first recorded day; today until the core has rolled one up. */
  get since(): number {
    return this.facts?.since ?? this.today;
  }

  /** Recording began less than a week ago. */
  get fresh(): boolean {
    return this.facts !== null && this.today - this.since < 7;
  }

  /** Too few days for the correction to judge a string. */
  get learning(): boolean {
    return this.today - this.since < 30;
  }

  readonly rows = $derived(
    stringRows(this.facts?.strings ?? [], {
      pmax: (type) => this.facts?.peaks.get(type),
      kwh: () => null,
      corrections: this.facts?.corrections ?? [],
    }),
  );

  get tabs(): StatsView["tab"][] {
    return tabsOf(this.view.metric, this.facts?.battery ?? false);
  }

  /** What tells one pane from the next: payback does not follow the range. */
  get paneId(): string {
    const v = this.view;
    const r: RangeRoute = this.route;

    return `${v.metric}/${v.tab}/${v.tab === "payback" ? "" : rangeKey(r.range)}`;
  }

  pick = (metric: Metric): void => {
    const r: RangeRoute = this.route;

    r.patch({ metric: metric === "energy" ? null : metric, tab: null, sid: null });
  };

  choose = (tab: string): void => {
    if (tab === this.view.tab) return;

    const r: RangeRoute = this.route;

    r.patch({ tab: tab === this.tabs[0] ? null : tab });
  };

  compare = (cmp: StatsView["cmp"]): void => {
    const r: RangeRoute = this.route;

    r.patch({ cmp: cmp === "year" ? "year" : null });
  };

  /** Opens a view and adds a history entry, so back returns. */
  open = (patch: Readonly<Record<string, string | null>>): void => {
    const r: RangeRoute = this.route;

    r.patch(patch, true);
  };

  follow = (n: Readonly<Note>): void => {
    const r: RangeRoute = this.route;

    if (n.range) r.open(n.range);
    else r.patch({ metric: "plant", tab: null }, true);
  };

  /** Which way a new question or tab lies, read once per change; a step morphs a chart in place. */
  travel = (): Travel => {
    const [mt, t, was] = [this.view.metric, this.view.tab, this.#shown];
    const tabs = this.tabs;
    const r: RangeRoute = this.route;

    let out: Travel = {
      kind: "shift",
      dir: side(METRICS.indexOf(mt) - METRICS.indexOf(was.metric)),
    };

    if (mt === was.metric && t === was.tab)
      out = { kind: t === "time" || t === "forecast" ? "keep" : "shift", dir: r.via.dir };
    else if (mt === was.metric)
      out = { kind: "shift", dir: side(tabs.indexOf(t) - tabs.indexOf(was.tab)) };

    [was.metric, was.tab] = [mt, t];

    return out;
  };
}
