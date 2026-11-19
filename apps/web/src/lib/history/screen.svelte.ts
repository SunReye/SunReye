// The statistics screen's state (ADR 11, 21): the range and the view in the hash route, what was
// read for them, and how a change of question, tab or range travels.
import { untrack } from "svelte";
import type { Core } from "../api/core.ts";
import { stringRows } from "../analytics/strings.ts";
import type { Travel } from "../range/Pager.svelte";
import { canStep, rangeKey, step, type Range } from "../range/range.ts";
import { RangeRoute, type Go } from "../range/route.svelte.ts";
import { readFacts, type Facts } from "./facts.ts";
import type { Note } from "./notes.ts";

export type { Summary } from "./summary.ts";

import { pending, StatsData, type Loaded } from "./stats.svelte.ts";
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
    | "records"
    | "batteryCapacity"
  >
>;

/** One pane's content. */
export interface Pane {
  readonly got: Loaded;
  readonly view: StatsView;
  readonly loading: boolean;
}

const side = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);

export class Statistics {
  readonly route: RangeRoute;
  readonly data: StatsData;
  facts = $state.raw<Facts | null>(null);

  readonly view: StatsView = $derived(viewOf(this.#params(), this.facts?.battery ?? false));
  /** A primitive, so a view that is only rebuilt does not reload the range. */
  readonly #cmp = $derived(this.view.cmp);

  readonly #shown: { metric: Metric; tab: StatsView["tab"] };
  /** The next range change came from a finger drag, so it slides. */
  #dragged = false;
  /** The range a drag paged to: its pane shows it loading, not the range it left. */
  #slidTo = $state<string | null>(null);

  constructor(input: () => { core: StatisticsCore; params: URLSearchParams; go: Go }) {
    this.route = new RangeRoute(() => input(), 0, VIEW_PARAMS);
    this.data = new StatsData(() => ({ core: input().core, route: this.route, cmp: this.#cmp }));
    this.#shown = untrack(() => ({ metric: this.view.metric, tab: this.view.tab }));

    // `input()` reads the route too: through a derived, a new range leaves the facts as read.
    const core = $derived(input().core);

    $effect(() => {
      let live = true;

      const read = async () => {
        // The facts only refine the screen; a failed read leaves them unread, and the chart's own
        // read states the failure.
        const next = await readFacts(core).catch(() => null);

        if (live && next !== null) this.facts = next;
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

  /** Null for a viewer, and until the facts are read. */
  get payback(): Facts["payback"] {
    return this.facts?.payback ?? null;
  }

  /** The payback tab is open, so the card beside the chart steps back. */
  get paybackOpen(): boolean {
    return this.view.metric === "money" && this.view.tab === "payback";
  }

  openPayback = (): void => {
    this.open({ metric: "money", tab: "payback" });
  };

  get tabs(): StatsView["tab"][] {
    return tabsOf(this.view.metric, this.facts?.battery ?? false);
  }

  /** What tells one pane from the next: payback does not follow the range. */
  get paneId(): string {
    const r: RangeRoute = this.route;

    return this.#paneOf(r.range);
  }

  #paneOf(range: Range): string {
    const v = this.view;

    return `${v.metric}/${v.tab}/${v.tab === "payback" ? "" : rangeKey(range)}`;
  }

  /** What the current pane shows; null before the first read. */
  get pane(): Pane | null {
    const got = this.data.current;
    const r: RangeRoute = this.route;
    const key = rangeKey(r.range);

    if (!got) return null;

    if (rangeKey(got.range) !== key && this.#slidTo === key)
      return { got: pending(got, r.range), view: this.view, loading: true };

    return { got, view: this.view, loading: this.data.loading || this.data.failed };
  }

  /** The neighbour a drag uncovers, drawn loading; null at the end of the record or for payback. */
  peek = (dir: -1 | 1): { id: string; data: Pane } | null => {
    const got = this.data.current;
    const r: RangeRoute = this.route;
    const cal = r.place.cal;

    if (!got || !canStep(cal, r.range, dir)) return null;

    const next = step(cal, r.range, dir);
    const id = this.#paneOf(next);

    return id === this.paneId
      ? null
      : { id, data: { got: pending(got, next), view: this.view, loading: true } };
  };

  /** A finger paged the range. */
  drag = (dir: -1 | 1): void => {
    const r: RangeRoute = this.route;

    this.#dragged = true;
    r.step(dir);
    this.#slidTo = untrack(() => rangeKey(r.range));
  };

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

    if (mt === was.metric && t === was.tab && this.#dragged)
      out = { kind: "slide", dir: r.via.dir };
    else if (mt === was.metric && t === was.tab)
      out = { kind: t === "time" || t === "forecast" ? "keep" : "shift", dir: r.via.dir };
    else if (mt === was.metric)
      out = { kind: "shift", dir: side(tabs.indexOf(t) - tabs.indexOf(was.tab)) };

    [was.metric, was.tab] = [mt, t];
    this.#dragged = false;

    return out;
  };
}
