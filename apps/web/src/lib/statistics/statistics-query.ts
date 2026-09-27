/**
 * Every read the statistics page makes, behind one seam. A section names a
 * dataset and a spec; which endpoint answers it, how it is keyed, what a live
 * push makes stale, and who still wants the answer when it lands are this
 * module's business — plain TS, so all of it is tested without runes.
 */

import type {
  BatteryHealth,
  CostBreakdown,
  CostSeriesPoint,
  PeriodEnergy,
} from "@SunReye/contracts/energy";
import type { SpotPriceView, SpotStats } from "@SunReye/contracts/prices";
import type {
  AmortisationResponse,
  CompareMode,
  ComparisonResponse,
  HeatmapCell,
  RecordsResponse,
} from "@SunReye/contracts/statistics";
import { payloadOrNull } from "$lib/api-payload";
import { specQuery, type ChartSpec, type CostBucket, type CostRange } from "$lib/cost/ranges";
import type { SourceId } from "$lib/source";
import { pricedWindow, referenceWindow, usableComparison } from "./compare";
import type { MonthlyValue } from "./yoy";

/** An Eden answer, as far as this module reads one. */
export type ApiResponse = { data: unknown; error?: unknown };

export type SourceQuery = { source: SourceId };
export type WindowQuery = SourceQuery & { from: string; to: string };
export type SeriesQuery = WindowQuery & { bucket: CostBucket };

/** The endpoints behind the page — the Eden client in production, a fake in tests. */
export interface StatisticsApi {
  comparison(query: WindowQuery & { mode: CompareMode }): Promise<ApiResponse>;
  costSeries(query: SeriesQuery): Promise<ApiResponse>;
  energySeries(query: SeriesQuery): Promise<ApiResponse>;
  records(query: SourceQuery): Promise<ApiResponse>;
  amortisation(query: SourceQuery): Promise<ApiResponse>;
  heatmap(query: WindowQuery): Promise<ApiResponse>;
  spotStats(query: WindowQuery): Promise<ApiResponse>;
  dayAheadPrices(): Promise<ApiResponse>;
  batteryHealth(): Promise<ApiResponse>;
}

/** The live stream's two staleness counters (`statisticsLive`). */
export interface LiveSignals {
  readonly revision: number;
  readonly priceRevision: number;
}

/**
 * Which counter makes a dataset stale. `revision` is a live push on a
 * now-inclusive range; `price` a spot-price sync.
 */
type Channel = "revision" | "price";

/** One pending read: subscribing starts (or reuses) the request, disposing
 *  guarantees the callback never runs. */
export interface StatisticsRead<T> {
  subscribe(onValue: (value: T) => void): () => void;
}

type CostSeries = { points: CostSeriesPoint[]; bucket: CostBucket };
type EnergySeries = { periods: PeriodEnergy[]; bucket: CostBucket };
type ComparisonPair = { current: CostBreakdown | null; previous: CostBreakdown | null };
type YoySeries = { net: MonthlyValue[]; production: MonthlyValue[] };

/** An answer, and whether the server gave it cleanly (only those are kept). */
type Fetched<T> = { value: T; ok: boolean };

type Entry = {
  /** The live counters this answer was fetched under; a mismatch is stale. */
  epoch: string;
  settled: boolean;
  value: unknown;
  waiting: Set<(value: unknown) => void>;
};

type Dataset<T> = {
  id: string;
  channels: readonly Channel[];
  query: unknown;
  fetch: () => Promise<Fetched<T>>;
};

/** Enough for every scope and zoom a reader flips between on one visit. */
const MAX_ENTRIES = 48;

/** Map a single Eden answer through `map`. */
const one =
  <T>(request: () => Promise<ApiResponse>, map: (data: unknown) => T) =>
  async (): Promise<Fetched<T>> => {
    const { data, error } = await request();
    return { value: map(data), ok: error == null };
  };

/**
 * A bounded cache of reads by key. An entry fetched under another epoch is
 * stale and refetched; a subscriber disposed before its answer lands never
 * hears it; readers of one key in flight share one request.
 */
function readCache(max: number) {
  const cache = new Map<string, Entry>();

  const forget = (key: string, entry: Entry) => {
    if (cache.get(key) === entry) cache.delete(key);
  };

  function entryFor(key: string, epoch: string, fetch: () => Promise<Fetched<unknown>>): Entry {
    const held = cache.get(key);
    if (held && held.epoch === epoch) {
      // Refresh recency: the Map's insertion order is the eviction order.
      cache.delete(key);
      cache.set(key, held);
      return held;
    }
    const entry: Entry = { epoch, settled: false, value: undefined, waiting: new Set() };
    cache.set(key, entry);
    for (const old of cache.keys()) {
      if (cache.size <= max) break;
      cache.delete(old);
    }
    fetch().then(
      ({ value, ok }) => {
        // A failed answer still reaches whoever is waiting (as its empty
        // fallback) but is not kept, so the next read asks again.
        if (ok) Object.assign(entry, { settled: true, value });
        else forget(key, entry);
        for (const deliver of entry.waiting) deliver(value);
        entry.waiting.clear();
      },
      () => forget(key, entry),
    );
    return entry;
  }

  return <T>(key: string, epoch: string, fetch: () => Promise<Fetched<T>>): StatisticsRead<T> => ({
    subscribe: (onValue) => {
      const entry = entryFor(key, epoch, fetch);
      const deliver = onValue as (value: unknown) => void;
      if (entry.settled) {
        deliver(entry.value);
        return () => {};
      }
      entry.waiting.add(deliver);
      return () => entry.waiting.delete(deliver);
    },
  });
}

export type StatisticsQueryDeps = {
  api: StatisticsApi;
  live: LiveSignals;
  source: { readonly query: SourceQuery };
  now?: () => Date;
  maxEntries?: number;
};

/**
 * One page visit's statistics reads. Create it once per mounted page: the
 * cache lives exactly as long as the page does, so returning to the page reads
 * fresh rather than the answer from the last visit.
 */
export function statisticsQuery(deps: StatisticsQueryDeps) {
  const { api, live, source } = deps;
  const now = deps.now ?? (() => new Date());
  const cached = readCache(deps.maxEntries ?? MAX_ENTRIES);

  /**
   * Key the dataset and take its epoch NOW, synchronously: that is what lets a
   * runes caller's `$effect` track the source and the live counters it reads.
   */
  function read<T>(dataset: Dataset<T>): StatisticsRead<T> {
    const epoch = dataset.channels
      .map((c) => (c === "price" ? live.priceRevision : live.revision))
      .join(",");
    return cached(`${dataset.id}|${JSON.stringify(dataset.query)}`, epoch, dataset.fetch);
  }

  return {
    /** The picked window beside its reference window, as the headline tiles read it. */
    comparison(range: CostRange, mode: CompareMode): StatisticsRead<ComparisonPair> {
      // The PRICED window, not the picked one: a period the reader is standing
      // in ends in the future, and comparing this month so far against the
      // whole of last month reads as a collapse that never happened.
      const window = pricedWindow(range, now());
      const reference = referenceWindow(window.from, window.to, mode);
      const query = {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        mode,
        ...source.query,
      };
      return read({
        id: "comparison",
        channels: ["revision"],
        query,
        // Also drops a reference window that predates recorded history, so a
        // first-month household never reads a fake −100%.
        fetch: one(
          () => api.comparison(query),
          (data) => usableComparison(payloadOrNull<ComparisonResponse>(data), reference),
        ),
      });
    },

    /** Cost bars at a section's scope, paired with the bucket they were fetched at. */
    costSeries(spec: ChartSpec): StatisticsRead<CostSeries> {
      const query = { ...specQuery(spec), ...source.query };
      return read({
        id: "costSeries",
        channels: ["revision"],
        query,
        fetch: one(
          () => api.costSeries(query),
          (data) => ({ points: (data ?? []) as CostSeriesPoint[], bucket: query.bucket }),
        ),
      });
    },

    /** Energy periods at a section's scope, paired with their bucket. */
    energySeries(spec: ChartSpec): StatisticsRead<EnergySeries> {
      const query = { ...specQuery(spec), ...source.query };
      return read({
        id: "energySeries",
        channels: ["revision"],
        query,
        fetch: one(
          () => api.energySeries(query),
          (data) => ({ periods: (data ?? []) as PeriodEnergy[], bucket: query.bucket }),
        ),
      });
    },

    /** Net cost and production per month over a trailing window. */
    yoy(window: { from: string; to: string }): StatisticsRead<YoySeries> {
      const query = { ...window, bucket: "month" as const, ...source.query };
      return read({
        id: "yoy",
        channels: [],
        query,
        fetch: async () => {
          const [cost, energy] = await Promise.all([
            api.costSeries(query),
            api.energySeries(query),
          ]);
          const costPoints = (cost.data ?? []) as CostSeriesPoint[];
          const energyPoints = (energy.data ?? []) as { bucket: string; productionKwh: number }[];
          return {
            ok: cost.error == null && energy.error == null,
            value: {
              net: costPoints.map((p) => ({ bucket: p.bucket, value: p.net })),
              production: energyPoints.map((p) => ({ bucket: p.bucket, value: p.productionKwh })),
            },
          };
        },
      });
    },

    /** All-time per-day records — rangeless, cached per day server-side. */
    records(): StatisticsRead<RecordsResponse | null> {
      const query = { ...source.query };
      return read({
        id: "records",
        channels: [],
        query,
        fetch: one(
          () => api.records(query),
          (data) => (data as RecordsResponse) ?? null,
        ),
      });
    },

    /** Payback against lifetime counters — rangeless. */
    amortisation(): StatisticsRead<AmortisationResponse | null> {
      const query = { ...source.query };
      return read({
        id: "amortisation",
        // The lifetime counters tick with every poll; the throttled live signal
        // keeps the savings figure moving on a wall display.
        channels: ["revision"],
        query,
        fetch: one(
          () => api.amortisation(query),
          (data) => payloadOrNull<AmortisationResponse>(data),
        ),
      });
    },

    /** The picked window folded onto one week of hours. */
    heatmap(from: Date, to: Date): StatisticsRead<HeatmapCell[]> {
      const query = { from: from.toISOString(), to: to.toISOString(), ...source.query };
      return read({
        id: "heatmap",
        channels: [],
        query,
        fetch: one(
          () => api.heatmap(query),
          (data) => (data ?? []) as HeatmapCell[],
        ),
      });
    },

    /** Spot-market analytics for the window; null when no feed is configured. */
    spotStats(from: Date, to: Date): StatisticsRead<SpotStats | null> {
      const query = { from: from.toISOString(), to: to.toISOString(), ...source.query };
      return read({
        id: "spotStats",
        channels: ["price"],
        query,
        fetch: one(
          () => api.spotStats(query),
          (data) => payloadOrNull<SpotStats>(data),
        ),
      });
    },

    /** Today's and tomorrow's day-ahead slots — the same whatever the range. */
    dayAheadPrices(): StatisticsRead<SpotPriceView | null> {
      return read({
        id: "dayAheadPrices",
        channels: ["price"],
        query: null,
        fetch: one(
          () => api.dayAheadPrices(),
          (data) => (data as SpotPriceView | null) ?? null,
        ),
      });
    },

    /**
     * Measured pack capacity and SOH. A property of the battery, not of the
     * range, so no window and no live channel: re-reading it per zoom would
     * query two numbers that cannot have changed.
     */
    batteryHealth(): StatisticsRead<BatteryHealth | null> {
      return read({
        id: "batteryHealth",
        channels: [],
        query: null,
        fetch: one(
          () => api.batteryHealth(),
          (data) => (data as BatteryHealth | null) ?? null,
        ),
      });
    },
  };
}

export type StatisticsQuery = ReturnType<typeof statisticsQuery>;
