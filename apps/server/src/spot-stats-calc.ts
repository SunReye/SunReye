/**
 * Pure spot-price analytics — no database, no inverter. Folds stored day-ahead
 * slots (and the plant's hourly import against them) into the figures the
 * statistics page's price section shows: how the market behaved, what the
 * household actually paid relative to it, and what a spot tariff would have
 * cost instead. DB-free so every branch is unit-testable (see
 * spot-stats-calc.test.ts); the DB-bound orchestration lives in
 * {@link ./spot-stats}.
 */

import { type TariffConfig, importPriceForHour, landedImportPrice } from "@SunReye/db/tariff";
import type { HourEnergy } from "./cost-calc";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * Start of the epoch hour an instant falls in. Both the hourly rollup buckets
 * and the market slots are epoch-aligned instants, so this is the join key
 * between energy and price without re-deriving a calendar on either side.
 */
const hourStartMs = (ms: number): number => Math.floor(ms / HOUR_MS) * HOUR_MS;

/** One stored market slot, reduced to what these folds need. */
export interface SpotPriceSlot {
  startMs: number;
  /** Slot width in minutes (15 or 60) — everything here averages by width. */
  minutes: number;
  eurPerMwh: number;
}

/** One day's SQL-side price aggregate, before the averages are derived. */
export interface SpotDailyRow {
  date: string;
  minEurPerMwh: number;
  maxEurPerMwh: number;
  slots: number;
  negativeSlots: number;
  /** Σ price·minutes and Σ minutes: days are averaged by slot WIDTH so a day
   *  mixing a 60-minute source with 15-minute slots isn't skewed toward the
   *  quarter-hours. */
  priceMinutes: number;
  minutes: number;
  negativeMinutes: number;
}

/** One day of the price series returned to the client. */
export interface SpotDailyStat {
  date: string;
  avgEurPerMwh: number;
  minEurPerMwh: number;
  maxEurPerMwh: number;
  slots: number;
  negativeSlots: number;
}

/** Window-wide price summary; null when the window holds no stored slot. */
export interface SpotSummary {
  avgEurPerMwh: number;
  minEurPerMwh: number;
  maxEurPerMwh: number;
  slots: number;
  negativeSlots: number;
  /** Wall-clock hours that cleared below zero, from the slot widths — the
   *  headline figure, since slot counts differ between 15- and 60-minute days. */
  negativeHours: number;
}

/** Derive the per-day series and its window-wide roll-up from the SQL rows. */
export function spotDailyStats(rows: readonly SpotDailyRow[]): {
  daily: SpotDailyStat[];
  summary: SpotSummary | null;
} {
  const daily = rows.map((r) => ({
    date: r.date,
    avgEurPerMwh: r.minutes > 0 ? r.priceMinutes / r.minutes : 0,
    minEurPerMwh: r.minEurPerMwh,
    maxEurPerMwh: r.maxEurPerMwh,
    slots: r.slots,
    negativeSlots: r.negativeSlots,
  }));
  if (rows.length === 0) return { daily, summary: null };

  const total = { priceMinutes: 0, minutes: 0, slots: 0, negativeSlots: 0, negativeMinutes: 0 };
  for (const r of rows) {
    total.priceMinutes += r.priceMinutes;
    total.minutes += r.minutes;
    total.slots += r.slots;
    total.negativeSlots += r.negativeSlots;
    total.negativeMinutes += r.negativeMinutes;
  }
  return {
    daily,
    summary: {
      avgEurPerMwh: total.minutes > 0 ? total.priceMinutes / total.minutes : 0,
      minEurPerMwh: Math.min(...rows.map((r) => r.minEurPerMwh)),
      maxEurPerMwh: Math.max(...rows.map((r) => r.maxEurPerMwh)),
      slots: total.slots,
      negativeSlots: total.negativeSlots,
      negativeHours: total.negativeMinutes / 60,
    },
  };
}

/** A contiguous run of below-zero market slots. */
export interface NegativeWindow {
  start: string;
  end: string;
  minEurPerMwh: number;
  slots: number;
}

const slotEndMs = (s: SpotPriceSlot): number => s.startMs + s.minutes * MINUTE_MS;

/**
 * Whether `s` extends the run `prev` belongs to: `prev` must itself be negative
 * and butt right up against `s`. A *gap* breaks the run — two negative slots
 * either side of a missing one are two windows, because the time between them
 * is unknown, not negative.
 */
const continuesRun = (prev: SpotPriceSlot | undefined, s: SpotPriceSlot): boolean =>
  prev !== undefined && prev.eurPerMwh < 0 && slotEndMs(prev) === s.startMs;

/** Split a slot slice into maximal runs of contiguous below-zero slots. Zero is
 *  not negative — the §51 trigger is strictly below zero (`exportPriceForSlot`
 *  in @SunReye/db/tariff), and this list must agree. */
function negativeRuns(slots: readonly SpotPriceSlot[]): SpotPriceSlot[][] {
  const runs: SpotPriceSlot[][] = [];
  slots.forEach((s, i) => {
    if (s.eurPerMwh >= 0) return;
    if (continuesRun(slots[i - 1], s)) runs[runs.length - 1]?.push(s);
    else runs.push([s]);
  });
  return runs;
}

const toWindow = (run: readonly SpotPriceSlot[]): NegativeWindow => ({
  start: new Date(Math.min(...run.map((s) => s.startMs))).toISOString(),
  end: new Date(Math.max(...run.map(slotEndMs))).toISOString(),
  minEurPerMwh: Math.min(...run.map((s) => s.eurPerMwh)),
  slots: run.length,
});

/** The below-zero price windows in a slot slice, in slot order. */
export function groupNegativeWindows(slots: readonly SpotPriceSlot[]): NegativeWindow[] {
  return negativeRuns(slots).map(toWindow);
}

/**
 * Width-weighted average market price per epoch hour. The energy side is only
 * read hourly, so this is the finest granularity the two can be joined at.
 */
export function hourlyAveragePrices(slots: readonly SpotPriceSlot[]): Map<number, number> {
  const acc = new Map<number, { priceMinutes: number; minutes: number }>();
  for (const s of slots) {
    const key = hourStartMs(s.startMs);
    const a = acc.get(key) ?? { priceMinutes: 0, minutes: 0 };
    a.priceMinutes += s.eurPerMwh * s.minutes;
    a.minutes += s.minutes;
    acc.set(key, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.priceMinutes / a.minutes]));
}

/** How the household's import timing compares with the market — both averages
 *  on a wholesale basis, so they are the same kind of number. */
export interface PaidVsMarket {
  importKwh: number;
  /** Σ(import·price) / Σ import over priced hours. Below the plain average
   *  means the plant imported in the cheaper hours. */
  importWeightedAvgEurPerMwh: number;
  /** Unweighted mean of the window's hourly prices. */
  plainAvgEurPerMwh: number;
  /** Share of imported kWh that fell in an hour with a known market price. */
  coverage: number;
}

/** Weight the window's import by the market price of the hour it fell in. Null
 *  when nothing was imported in a priced hour — there is no average then. */
export function paidVsMarket(
  hours: readonly HourEnergy[],
  priceByHour: ReadonlyMap<number, number>,
): PaidVsMarket | null {
  if (priceByHour.size === 0) return null;
  let importKwh = 0;
  let pricedKwh = 0;
  let weighted = 0;
  for (const h of hours) {
    importKwh += h.import;
    const price = priceByHour.get(hourStartMs(h.time.getTime()));
    if (price === undefined) continue;
    pricedKwh += h.import;
    weighted += h.import * price;
  }
  if (pricedKwh <= 0) return null;
  let plain = 0;
  for (const p of priceByHour.values()) plain += p;
  return {
    importKwh,
    importWeightedAvgEurPerMwh: weighted / pricedKwh,
    plainAvgEurPerMwh: plain / priceByHour.size,
    coverage: importKwh > 0 ? pricedKwh / importKwh : 0,
  };
}

/** What the window's import would have cost under each import model. */
export interface SpotWhatIf {
  /** Priced from the tariff's time-of-use bands. */
  staticCost: number;
  /** Priced from the market, landed through the tariff's spot components. */
  spotCost: number;
  /** `spotCost − staticCost`: negative means spot would have been cheaper. */
  delta: number;
  /**
   * Whether `import.spot` carries any real component. With markup, grid fees,
   * levies and VAT all at zero the "spot cost" is bare wholesale and grossly
   * understates a bill — the UI must caption the figure accordingly rather than
   * present it as a quote.
   */
  spotComponentsConfigured: boolean;
  /** Share of imported kWh that had a market price. */
  coverage: number;
}

/** ISO weekday (1=Mon … 7=Sun) from a Date's local day. */
const isoWeekday = (d: Date): number => ((d.getDay() + 6) % 7) + 1;

const hasSpotComponents = (tariff: TariffConfig): boolean => {
  const s = tariff.import.spot;
  return (
    s.supplierMarkupPerKwh !== 0 ||
    s.gridFeesPerKwh !== 0 ||
    s.leviesPerKwh !== 0 ||
    s.vatPercent !== 0
  );
};

/**
 * Reprice the window's import both ways. An hour with no stored market price
 * falls back to the band price on BOTH sides, so it contributes identically to
 * each total and cancels out of the delta — the comparison stays honest over a
 * partially covered window, and `coverage` says how much of it was real.
 *
 * Null when nothing was imported: a zero-vs-zero comparison is not a finding.
 */
export function spotWhatIf(
  hours: readonly HourEnergy[],
  tariff: TariffConfig,
  priceByHour: ReadonlyMap<number, number>,
): SpotWhatIf | null {
  if (priceByHour.size === 0) return null;
  let staticCost = 0;
  let spotCost = 0;
  let importKwh = 0;
  let pricedKwh = 0;
  for (const h of hours) {
    const band = importPriceForHour(tariff, h.time.getHours(), isoWeekday(h.time));
    const price = priceByHour.get(hourStartMs(h.time.getTime()));
    importKwh += h.import;
    staticCost += h.import * band;
    spotCost +=
      h.import * (price === undefined ? band : landedImportPrice(price, tariff.import.spot));
    if (price !== undefined) pricedKwh += h.import;
  }
  if (importKwh <= 0) return null;
  return {
    staticCost,
    spotCost,
    delta: spotCost - staticCost,
    spotComponentsConfigured: hasSpotComponents(tariff),
    coverage: pricedKwh / importKwh,
  };
}
