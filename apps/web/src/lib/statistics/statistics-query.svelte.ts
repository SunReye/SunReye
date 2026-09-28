/**
 * The reactive shell over `./statistics-query.ts`: the page provides one
 * `StatisticsQuery` per visit, and a section turns a read into `$state` with
 * `queried`. Everything that can be wrong about a fetch — keying, staleness,
 * a late answer — is decided in the plain module, where it is tested.
 */

import { getContext, setContext } from "svelte";
import { api } from "$lib/api";
import { source } from "$lib/source.svelte";
import { statisticsLive } from "$lib/statistics-live.svelte";
import {
  statisticsQuery,
  type StatisticsApi,
  type StatisticsQuery,
  type StatisticsRead,
} from "./statistics-query";

const KEY = Symbol("statistics-query");

/** The Eden client, as the seam the query module takes. */
const edenApi: StatisticsApi = {
  comparison: (query) => api.api.statistics.comparison.get({ query }),
  costSeries: (query) => api.api.cost.series.get({ query }),
  energySeries: (query) => api.api.energy.series.get({ query }),
  records: (query) => api.api.statistics.records.get({ query }),
  amortisation: (query) => api.api.statistics.amortisation.get({ query }),
  heatmap: (query) => api.api.statistics.heatmap.get({ query }),
  spotStats: (query) => api.api.statistics.prices.get({ query }),
  dayAheadPrices: () => api.api.prices.get(),
  batteryHealth: () => api.api.battery.health.get(),
};

/** Called once by the statistics page: this visit's reads, shared by every section. */
export function provideStatisticsQuery(): StatisticsQuery {
  return setContext(KEY, statisticsQuery({ api: edenApi, live: statisticsLive, source }));
}

/** The page's reads, from any section body below it. */
export function useStatisticsQuery(): StatisticsQuery {
  const query = getContext<StatisticsQuery | undefined>(KEY);
  if (!query) throw new Error("useStatisticsQuery: no statistics page above this component");
  return query;
}

export type Queried<T> = {
  /** The newest answer, or the initial value until one lands. Kept across a
   *  re-read, so a range change refreshes in place instead of blanking. */
  readonly value: T;
  /** True once any answer has landed. */
  readonly loaded: boolean;
  /** True while the current read is outstanding. */
  readonly loading: boolean;
};

/**
 * Hold `read()`'s answer as state. Whatever `read` touches — the spec, the
 * source, the live counters its dataset listens to — re-runs it; the previous
 * read is disposed first, so a slower earlier answer can never land. `null`
 * means "nothing to read right now" and keeps the value held.
 */
export function queried<T>(read: () => StatisticsRead<T> | null, initial: T): Queried<T> {
  let value = $state.raw(initial);
  let loaded = $state(false);
  let loading = $state(false);
  $effect(() => {
    const pending = read();
    loading = pending !== null;
    if (!pending) return;
    return pending.subscribe((next) => {
      value = next;
      loaded = true;
      loading = false;
    });
  });
  return {
    get value() {
      return value;
    },
    get loaded() {
      return loaded;
    },
    get loading() {
      return loading;
    },
  };
}
