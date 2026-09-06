// Tile registries for the statistics page. Pure data + functions so every tile
// derivation is unit-testable without mounting a component; the route's
// stat-tiles.svelte renders whatever a registry yields for the current
// payload. Every section's tiles — cost, energy, prices, records — are a
// registry against the same TileDef surface.

import type { BatteryHealth, CostBreakdown, CostTotals } from "@SunReye/contracts/energy";
import type { SpotStats, SpotWhatIf } from "@SunReye/contracts/prices";
import type {
  AmortisationResponse,
  DayRecord,
  RecordsResponse,
} from "@SunReye/contracts/statistics";
import type { CostFormatters } from "$lib/cost/format";
import { dayKeyDate, dayMonthYear } from "$lib/format/date";
import { decimal } from "$lib/format/number";
import { ctLabel, ctPerKwh } from "$lib/prices/price-series";
import { deltaFor } from "$lib/statistics/compare";
import * as m from "$lib/paraglide/messages";

/** Rendered face of one tile. */
export type TileView = {
  value: string;
  sub: string;
  /** Tailwind text-* class emphasising a figure in the household's favour. */
  accent: string;
};

export type TileDef<Data> = {
  /**
   * Stable id, namespaced "section.tile" — the customize preferences hide
   * tiles by this id, so it must not change once shipped.
   */
  id: string;
  label: () => string;
  explain: () => string;
  /** Format the tile for one payload; `null` omits it entirely (capability
   *  gating — e.g. §51 never cost this plant anything). */
  compute: (data: Data, f: CostFormatters) => TileView | null;
  /**
   * The unformatted headline figure for the same payload. Never rendered
   * directly — it is what the delta chip diffs across the two windows.
   */
  raw: (data: Data) => number | null;
  /** Which delta direction is good for the household; drives future chip color. */
  goodDirection: "up" | "down" | "neutral";
};

/** Tiles turn green only when the figure is in the household's favour. */
const goodIf = (favourable: boolean): string => (favourable ? "text-sign-good" : "");

/**
 * The nine cost tiles, 1:1 from the costs page they replace. Order is render
 * order; the §51 tile sits second so a spot+EEG plant sees the forgone energy
 * right beside what the grid cost.
 */
export const COST_TILES: readonly TileDef<CostBreakdown>[] = [
  {
    id: "cost.gridCost",
    label: m.costs_tile_grid_cost,
    explain: m.costs_tile_grid_cost_explain,
    compute: (c, f) => ({
      value: f.money(c.importCost + c.standingCharge),
      sub: m.costs_sub_grid_cost({
        imported: f.money(c.importCost),
        standing: f.money(c.standingCharge),
      }),
      accent: "",
    }),
    raw: (c) => c.importCost + c.standingCharge,
    goodDirection: "down",
  },
  {
    id: "cost.zeroValueExport",
    label: m.costs_tile_zero_value,
    explain: m.costs_tile_zero_value_explain,
    // Only once §51 has actually cost something: on a plant that never opted
    // in, or a day with no negative slots, the tile would be a permanent zero.
    compute: (c, f) =>
      c.zeroValueExportKwh > 0
        ? {
            value: f.kwh(c.zeroValueExportKwh),
            sub: m.costs_sub_zero_value({ amount: f.money(c.zeroValueExportEur) }),
            accent: "",
          }
        : null,
    raw: (c) => c.zeroValueExportKwh,
    goodDirection: "down",
  },
  {
    id: "cost.effectiveCost",
    label: m.costs_tile_effective_cost,
    explain: m.costs_tile_effective_cost_explain,
    compute: (c, f) => ({
      value: f.money(c.net),
      sub: m.costs_sub_effective_cost({ amount: f.money(c.exportEarnings) }),
      accent: goodIf(c.net < 0),
    }),
    raw: (c) => c.net,
    goodDirection: "down",
  },
  {
    id: "cost.gridImport",
    label: m.costs_tile_grid_import,
    explain: m.costs_tile_grid_import_explain,
    compute: (c, f) => ({
      value: f.money(c.importCost),
      sub: m.costs_sub_grid_import({ energy: f.kwh(c.importKwh) }),
      accent: "",
    }),
    raw: (c) => c.importCost,
    goodDirection: "down",
  },
  {
    id: "cost.gridExport",
    label: m.costs_tile_grid_export,
    explain: m.costs_tile_grid_export_explain,
    compute: (c, f) => ({
      value: f.money(c.exportEarnings),
      sub: m.costs_sub_grid_export({ energy: f.kwh(c.exportKwh) }),
      accent: goodIf(c.exportEarnings > 0),
    }),
    raw: (c) => c.exportEarnings,
    goodDirection: "up",
  },
  {
    id: "cost.solarSaving",
    label: m.costs_tile_solar_saving,
    explain: m.costs_tile_solar_saving_explain,
    // Sub-line: self-consumed kWh × effective grid price = saving. The
    // effective price is the saving spread over the self-consumed energy, so
    // it stays band-accurate without the server returning a separate price.
    compute: (c, f) => ({
      value: f.money(c.solarSavings),
      sub:
        c.solarToLoadKwh > 0
          ? `${f.kwh(c.solarToLoadKwh)} × ${f.price(c.solarSavings / c.solarToLoadKwh)}`
          : m.costs_sub_self_consumed(),
      accent: goodIf(c.solarSavings > 0),
    }),
    raw: (c) => c.solarSavings,
    goodDirection: "up",
  },
  {
    id: "cost.totalSavings",
    label: m.costs_tile_total_savings,
    explain: m.costs_tile_total_savings_explain,
    compute: (c, f) => ({
      value: f.money(c.savings),
      sub: m.costs_sub_total_savings({ amount: f.money(c.exportEarnings) }),
      accent: goodIf(c.savings > 0),
    }),
    raw: (c) => c.savings,
    goodDirection: "up",
  },
  {
    id: "cost.selfSufficiency",
    label: m.costs_tile_self_sufficiency,
    explain: m.costs_tile_self_sufficiency_explain,
    compute: (c, f) => ({
      value: f.pct(c.selfSufficiency),
      sub: m.costs_sub_self_sufficiency(),
      accent: "",
    }),
    raw: (c) => c.selfSufficiency,
    goodDirection: "up",
  },
  {
    id: "cost.selfConsumption",
    label: m.costs_tile_self_consumption,
    explain: m.costs_tile_self_consumption_explain,
    compute: (c, f) => ({
      value: f.pct(c.selfConsumption),
      sub: m.costs_sub_self_consumption(),
      accent: "",
    }),
    raw: (c) => c.selfConsumption,
    goodDirection: "up",
  },
];

/**
 * Payload of the energy tile row: the window's totals, the comparison
 * endpoint's reference window, and how many days the window spans (for the
 * "per day" sub-line). Both windows come from the ONE `/api/statistics/comparison`
 * request the page already makes — the energy row costs no extra fetch.
 */
export type EnergyTileData = {
  current: CostTotals;
  /** Reference window; `null` when the comparison endpoint is unavailable or
   *  the window predates recorded history. */
  previous: CostTotals | null;
  /** Length of the current window in days, ≥ 1. */
  rangeDays: number;
  /** Whether this plant has a battery at all (profile manifest). Keeps the
   *  battery tiles off a batteryless system even mid-fetch, when a zero total
   *  would otherwise be indistinguishable from an idle pack. */
  hasBattery: boolean;
  /** Measured capacity and SOH. Window-INDEPENDENT — the same figures whatever
   *  range is picked — and null until the server has measured enough discharge
   *  segments to answer. */
  health: BatteryHealth | null;
};

/** Sub-line shared by every energy tile: the daily average. The change against
 *  the reference window is the tile's delta chip — one delta per tile, in one
 *  presentation. */
const perDaySub = (kwh: number, d: EnergyTileData, f: CostFormatters): string =>
  m.statistics_sub_per_day({ amount: f.kwh(kwh / d.rangeDays) });

/** One energy tile: same figure read off both windows, formatted as kWh. */
function energyTile(
  id: string,
  label: () => string,
  explain: () => string,
  value: (t: CostTotals) => number,
  goodDirection: TileDef<EnergyTileData>["goodDirection"],
  /** Extra capability gate on top of "the plant produced/consumed nothing". */
  applies: (d: EnergyTileData) => boolean = () => true,
): TileDef<EnergyTileData> {
  return {
    id,
    label,
    explain,
    compute: (d, f) => {
      if (!applies(d)) return null;
      const kwh = value(d.current);
      return {
        value: f.kwh(kwh),
        sub: perDaySub(kwh, d, f),
        accent: "",
      };
    },
    raw: (d) => (applies(d) ? value(d.current) : null),
    goodDirection,
  };
}

/**
 * A battery figure is worth a tile when the plant has a pack at all — an idle
 * window is itself information — but never on a plant without one.
 */
const hasBatteryEnergy = (d: EnergyTileData): boolean =>
  d.hasBattery ||
  d.current.batteryChargeKwh > 0 ||
  d.current.batteryDischargeKwh > 0 ||
  (d.previous?.batteryChargeKwh ?? 0) > 0 ||
  (d.previous?.batteryDischargeKwh ?? 0) > 0;

/**
 * The energy totals row at the top of the Energy section. These answer the
 * everyday question ("how much did we produce last month?") in figures, so a
 * reader never has to integrate a chart by eye.
 */
export const ENERGY_TILES: readonly TileDef<EnergyTileData>[] = [
  energyTile(
    "energy.produced",
    m.statistics_tile_produced,
    m.statistics_tile_produced_explain,
    (t) => t.productionKwh,
    "up",
  ),
  energyTile(
    "energy.consumed",
    m.statistics_tile_consumed,
    m.statistics_tile_consumed_explain,
    (t) => t.loadKwh,
    "down",
  ),
  energyTile(
    "energy.selfUsed",
    m.statistics_tile_self_used,
    m.statistics_tile_self_used_explain,
    // Self-consumption, the same measure the ratio tile reports: production the
    // plant kept. Not load − import, which counts battery discharge the sun put
    // there on an earlier day.
    (t) => Math.max(0, t.productionKwh - t.exportKwh),
    "up",
  ),
  // Both grid figures are unconditional: a zero is the answer to the question
  // ("we bought nothing from the grid all August"), so there is no capability
  // gate here — a meter that reads zero is still a meter.
  energyTile(
    "energy.gridImported",
    m.statistics_tile_grid_imported,
    m.statistics_tile_grid_imported_explain,
    (t) => t.importKwh,
    "down",
  ),
  energyTile(
    "energy.gridExported",
    m.statistics_tile_grid_exported,
    m.statistics_tile_grid_exported_explain,
    // The complement of the self-used tile: produced = self-used + exported,
    // which is why the explain string names the identity rather than leaving
    // the reader to wonder which of the two is the "real" number.
    (t) => t.exportKwh,
    "neutral",
  ),
  energyTile(
    "energy.batteryCharged",
    m.statistics_tile_battery_charged,
    m.statistics_tile_battery_charged_explain,
    (t) => t.batteryChargeKwh,
    "neutral",
    hasBatteryEnergy,
  ),
  energyTile(
    "energy.batteryDischarged",
    m.statistics_tile_battery_discharged,
    m.statistics_tile_battery_discharged_explain,
    (t) => t.batteryDischargeKwh,
    "neutral",
    hasBatteryEnergy,
  ),
  {
    id: "energy.batteryRoundTrip",
    label: m.statistics_tile_battery_round_trip,
    explain: m.statistics_tile_battery_round_trip_explain,
    compute: (d, f) => {
      const ratio = roundTripEfficiency(d);
      if (ratio === null) return null;
      return {
        value: f.pct(ratio),
        sub: m.statistics_sub_round_trip({
          discharged: f.kwh(d.current.batteryDischargeKwh),
          charged: f.kwh(d.current.batteryChargeKwh),
        }),
        accent: "",
      };
    },
    raw: roundTripEfficiency,
    goodDirection: "up",
  },
  {
    id: "energy.batteryCapacity",
    label: m.statistics_tile_battery_capacity,
    explain: m.statistics_tile_battery_capacity_explain,
    compute: (d, f) => {
      const capacity = measuredCapacity(d);
      if (!capacity) return null;
      return {
        value: f.kwh(capacity.kwh),
        sub: m.statistics_sub_measured_over({ count: capacity.segments }),
        accent: "",
      };
    },
    raw: (d) => measuredCapacity(d)?.kwh ?? null,
    goodDirection: "up",
  },
  {
    id: "energy.batteryHealth",
    label: m.statistics_tile_battery_health,
    explain: m.statistics_tile_battery_health_explain,
    compute: (d, f) => {
      const health = measuredHealth(d);
      if (!health) return null;
      return {
        value: f.pct(health.ratio),
        sub:
          health.reference === "nameplate"
            ? m.statistics_sub_of_nameplate({ amount: f.kwh(health.referenceKwh) })
            : m.statistics_sub_of_baseline({ amount: f.kwh(health.referenceKwh) }),
        accent: "",
      };
    },
    raw: (d) => measuredHealth(d)?.ratio ?? null,
    goodDirection: "up",
  },
];

/**
 * Round-trip efficiency: the energy the pack gave back, over the energy it took
 * in, across the whole window.
 *
 * The arithmetic is a division. The care is all in when NOT to do it.
 *
 * The identity `discharge / charge = efficiency` holds only if the pack holds
 * the same energy at both ends of the window. Whatever it gained across the
 * boundary was charged and never discharged, so it inflates the denominator;
 * whatever it lost does the reverse. That drift is bounded by roughly one full
 * cycle, and a day's throughput is roughly one cycle, so the relative error is
 * on the order of `1 / rangeDays` — 100 % over a day, ~3 % over a month. Hence
 * {@link MIN_ROUND_TRIP_DAYS}: the tile declines short windows instead of
 * printing a confident number that is mostly boundary drift.
 *
 * The plausibility band catches the same problem when the window is long but the
 * drift is large anyway (a pack that sat full for three weeks, a capacity
 * change, a counter reset). Above 1 the pack returned more than it stored, which
 * is not efficiency; below {@link MIN_PLAUSIBLE_ROUND_TRIP} no real chemistry
 * applies. Both are reports about the edges, and neither is worth showing as an
 * efficiency.
 *
 * Correcting rather than declining would need the pack's usable capacity and its
 * SOC at both edges — `usableKwh` is optional forecast config, so it cannot be
 * assumed present. That is the upgrade path, not this tile.
 */
const MIN_ROUND_TRIP_DAYS = 14;
const MIN_PLAUSIBLE_ROUND_TRIP = 0.5;

function roundTripEfficiency(d: EnergyTileData): number | null {
  if (!hasBatteryEnergy(d)) return null;
  if (d.rangeDays < MIN_ROUND_TRIP_DAYS) return null;
  const { batteryChargeKwh: charged, batteryDischargeKwh: discharged } = d.current;
  if (charged <= 0 || discharged <= 0) return null;
  const ratio = discharged / charged;
  if (ratio > 1 || ratio < MIN_PLAUSIBLE_ROUND_TRIP) return null;
  return ratio;
}

/**
 * The measured figures, behind the same battery gate as the energy pair.
 *
 * The gate matters independently of the server's answer: a plant with no pack
 * should never see a capacity, even if a stale or mis-addressed response
 * carried one.
 */
const measuredCapacity = (d: EnergyTileData) =>
  hasBatteryEnergy(d) ? (d.health?.capacity ?? null) : null;

/** Null until there is both a capacity and something to measure it against. */
const measuredHealth = (d: EnergyTileData) =>
  hasBatteryEnergy(d) ? (d.health?.health ?? null) : null;

/** One resolved, render-ready tile. */
export type Tile = {
  id: string;
  label: string;
  explain: string;
  /** Signed change against the reference payload: `undefined` when the caller
   *  passed none (no chip at all), `null` when the change is not meaningful
   *  (chip renders an em-dash). */
  delta?: number | null;
  goodDirection: TileDef<unknown>["goodDirection"];
} & TileView;

/**
 * Resolve a registry against one payload, dropping non-applicable tiles. Pass
 * `previous` — the same shape over a reference window — to have every tile
 * carry its signed change.
 */
export function deriveTiles<Data>(
  defs: readonly TileDef<Data>[],
  data: Data,
  f: CostFormatters,
  previous?: Data,
): Tile[] {
  return defs.flatMap((def) => {
    const view = def.compute(data, f);
    if (!view) return [];
    const delta = previous === undefined ? undefined : deltaFor(def.raw(data), def.raw(previous));
    return [
      {
        id: def.id,
        label: def.label(),
        explain: def.explain(),
        goodDirection: def.goodDirection,
        delta,
        ...view,
      },
    ];
  });
}

/** The same tile under a new id and explanation — one figure, two framings. */
const restated = (from: string, id: string, explain: () => string): TileDef<CostBreakdown> => {
  const def = COST_TILES.find((t) => t.id === from);
  if (!def) throw new Error(`unknown cost tile: ${from}`);
  return { ...def, id, explain };
};

/**
 * Period-over-period tiles for the records section. Same figures the cost
 * section leads with, but read against the reference window: the section's
 * caption names it ("vs previous 31 days"), and the delta chip carries the
 * comparison, so these are deliberately the household's four headline numbers
 * rather than a second, different set.
 */
export const COMPARISON_TILES: readonly TileDef<CostBreakdown>[] = [
  {
    id: "records.netCost",
    label: m.costs_tile_effective_cost,
    explain: m.statistics_records_net_explain,
    compute: (c, f) => ({
      value: f.money(c.net),
      sub: m.statistics_records_sub_net(),
      accent: goodIf(c.net < 0),
    }),
    raw: (c) => c.net,
    goodDirection: "down",
  },
  {
    id: "records.savings",
    label: m.costs_tile_total_savings,
    explain: m.statistics_records_savings_explain,
    compute: (c, f) => ({
      value: f.money(c.savings),
      sub: m.statistics_records_sub_savings(),
      accent: goodIf(c.savings > 0),
    }),
    raw: (c) => c.savings,
    goodDirection: "up",
  },
  {
    id: "records.import",
    label: m.costs_tile_grid_import,
    explain: m.statistics_records_import_explain,
    compute: (c, f) => ({
      value: f.kwh(c.importKwh),
      sub: m.statistics_records_sub_import({ amount: f.money(c.importCost) }),
      accent: "",
    }),
    raw: (c) => c.importKwh,
    goodDirection: "down",
  },
  // Identical figure to the cost section's tile, re-explained for the
  // comparison framing — restated rather than re-written so the two can never
  // drift apart.
  restated(
    "cost.selfSufficiency",
    "records.selfSufficiency",
    m.statistics_records_self_sufficiency_explain,
  ),
];

/** Locale date for a `YYYY-MM-DD` record day. */
const recordDay = (date: string): string => dayMonthYear(dayKeyDate(date));

/**
 * One all-time record tile. `pick` is what makes a tile applicable: money
 * records are null outside the server's hourly-pricing horizon, and any
 * record is null before there is a full day of history — either way the tile
 * is dropped rather than rendered empty.
 */
const recordTile = (
  id: string,
  label: () => string,
  explain: () => string,
  pick: (r: RecordsResponse) => DayRecord | null | undefined,
  format: (v: number, f: CostFormatters) => string,
  goodDirection: TileDef<RecordsResponse>["goodDirection"],
): TileDef<RecordsResponse> => ({
  id,
  label,
  explain,
  compute: (r, f) => {
    const day = pick(r);
    return day ? { value: format(day.value, f), sub: recordDay(day.date), accent: "" } : null;
  },
  raw: (r) => pick(r)?.value ?? null,
  goodDirection,
});

/**
 * All-time per-day records. Energy records reach back over the whole daily
 * history; the money ones only cover the horizon the server can price, and
 * come back null outside it.
 */
export const RECORD_TILES: readonly TileDef<RecordsResponse>[] = [
  recordTile(
    "records.maxProduction",
    m.statistics_records_max_production,
    m.statistics_records_max_production_explain,
    (r) => r.energy?.maxProductionDay,
    (v, f) => f.kwh(v),
    "up",
  ),
  recordTile(
    "records.maxExport",
    m.statistics_records_max_export,
    m.statistics_records_max_export_explain,
    (r) => r.energy?.maxExportDay,
    (v, f) => f.kwh(v),
    "up",
  ),
  recordTile(
    "records.maxLoad",
    m.statistics_records_max_load,
    m.statistics_records_max_load_explain,
    (r) => r.energy?.maxLoadDay,
    (v, f) => f.kwh(v),
    "neutral",
  ),
  recordTile(
    "records.maxImport",
    m.statistics_records_max_import,
    m.statistics_records_max_import_explain,
    (r) => r.energy?.maxImportDay,
    (v, f) => f.kwh(v),
    "down",
  ),
  recordTile(
    "records.bestSelfSufficiency",
    m.statistics_records_best_self_sufficiency,
    m.statistics_records_best_self_sufficiency_explain,
    (r) => r.energy?.bestSelfSufficiencyDay,
    (v, f) => f.pct(v),
    "up",
  ),
  recordTile(
    "records.worstSelfSufficiency",
    m.statistics_records_worst_self_sufficiency,
    m.statistics_records_worst_self_sufficiency_explain,
    (r) => r.energy?.worstSelfSufficiencyDay,
    (v, f) => f.pct(v),
    "up",
  ),
  recordTile(
    "records.cheapestDay",
    m.statistics_records_cheapest_day,
    m.statistics_records_cheapest_day_explain,
    (r) => r.money?.cheapestDay,
    (v, f) => f.money(v),
    "down",
  ),
  recordTile(
    "records.mostExpensiveDay",
    m.statistics_records_priciest_day,
    m.statistics_records_priciest_day_explain,
    (r) => r.money?.mostExpensiveDay,
    (v, f) => f.money(v),
    "down",
  ),
  recordTile(
    "records.bestEarningsDay",
    m.statistics_records_best_earnings,
    m.statistics_records_best_earnings_explain,
    (r) => r.money?.bestEarningsDay,
    (v, f) => f.money(v),
    "up",
  ),
];

/**
 * Locale date of the day that held a window extreme, so "cheapest slot" says
 * *when*. Null when no day matches — the tile then falls back to naming the
 * zone rather than stating a day it can't identify.
 */
const extremeDay = (
  stats: SpotStats,
  target: number,
  value: (d: SpotStats["daily"][number]) => number,
): string | null => {
  const day = stats.daily.find((d) => value(d) === target);
  return day ? recordDay(day.date) : null;
};

/**
 * One market-price tile. Every figure here is *wholesale* (what the market did),
 * never a bill: the tiles are only meaningful once the window holds stored
 * slots, so all of them drop out with `summary`.
 */
const marketTile = (
  id: string,
  label: () => string,
  explain: () => string,
  value: (s: NonNullable<SpotStats["summary"]>) => number,
  view: (s: SpotStats, summary: NonNullable<SpotStats["summary"]>) => TileView,
  goodDirection: TileDef<SpotStats>["goodDirection"],
): TileDef<SpotStats> => ({
  id,
  label,
  explain,
  compute: (s) => (s.summary ? view(s, s.summary) : null),
  raw: (s) => (s.summary ? value(s.summary) : null),
  goodDirection,
});

/**
 * Headline market figures for the picked window. `ct/kWh` throughout rather
 * than the EUR/MWh the market quotes — a household reads its bill in cents.
 */
export const PRICE_TILES: readonly TileDef<SpotStats>[] = [
  marketTile(
    "prices.marketAvg",
    m.statistics_prices_tile_avg,
    m.statistics_prices_tile_avg_explain,
    (s) => s.avgEurPerMwh,
    (s, summary) => ({
      value: ctLabel(ctPerKwh(summary.avgEurPerMwh)),
      sub: m.statistics_prices_sub_zone({ zone: s.zone }),
      accent: "",
    }),
    "down",
  ),
  marketTile(
    "prices.marketMin",
    m.statistics_prices_tile_min,
    m.statistics_prices_tile_min_explain,
    (s) => s.minEurPerMwh,
    (s, summary) => ({
      value: ctLabel(ctPerKwh(summary.minEurPerMwh)),
      sub:
        extremeDay(s, summary.minEurPerMwh, (d) => d.minEurPerMwh) ??
        m.statistics_prices_sub_zone({ zone: s.zone }),
      accent: "",
    }),
    "down",
  ),
  marketTile(
    "prices.marketMax",
    m.statistics_prices_tile_max,
    m.statistics_prices_tile_max_explain,
    (s) => s.maxEurPerMwh,
    (s, summary) => ({
      value: ctLabel(ctPerKwh(summary.maxEurPerMwh)),
      sub:
        extremeDay(s, summary.maxEurPerMwh, (d) => d.maxEurPerMwh) ??
        m.statistics_prices_sub_zone({ zone: s.zone }),
      accent: "",
    }),
    "up",
  ),
  marketTile(
    "prices.negativeHours",
    m.statistics_prices_tile_negative_hours,
    m.statistics_prices_tile_negative_hours_explain,
    (s) => s.negativeHours,
    (_s, summary) => ({
      value: `${decimal(summary.negativeHours)} h`,
      sub:
        summary.negativeSlots === 1
          ? m.statistics_prices_sub_negative_one()
          : m.statistics_prices_sub_negative_other({ slots: summary.negativeSlots }),
      accent: "",
    }),
    "neutral",
  ),
  {
    id: "prices.paidVsMarket",
    label: m.statistics_prices_tile_paid,
    explain: m.statistics_prices_tile_paid_explain,
    // Only once the plant imported something in a priced hour: without that
    // there is no weighted average to state.
    // Read against the same market average the tile beside it states — one
    // market figure on the screen, not two that differ in weighting.
    compute: (s) =>
      s.paidVsMarket && s.summary
        ? {
            value: ctLabel(ctPerKwh(s.paidVsMarket.importWeightedAvgEurPerMwh)),
            sub: m.statistics_prices_sub_paid({
              market: ctLabel(ctPerKwh(s.summary.avgEurPerMwh)),
            }),
            // Below the market average means the house bought in cheaper hours.
            accent: goodIf(s.paidVsMarket.importWeightedAvgEurPerMwh < s.summary.avgEurPerMwh),
          }
        : null,
    raw: (s) => s.paidVsMarket?.importWeightedAvgEurPerMwh ?? null,
    goodDirection: "down",
  },
];

/**
 * The what-if row: the window's imported energy repriced both ways. Both
 * figures come from the SAME fold over the same hours (see `spotWhatIf`), so
 * they are comparable; the section captions how much of the window had a market
 * price and whether the tariff's spot components make the spot side a real
 * quote.
 *
 * Deliberately no "actual" tile: the household's real import cost is computed
 * over the picked range, while the what-if covers the (possibly shorter) window
 * prices are stored for — putting them side by side would compare two windows.
 */
export const WHATIF_TILES: readonly TileDef<SpotWhatIf>[] = [
  {
    id: "prices.whatIfStatic",
    label: m.statistics_prices_tile_static,
    explain: m.statistics_prices_tile_static_explain,
    compute: (w, f) => ({
      value: f.money(w.staticCost),
      sub: m.statistics_prices_sub_static(),
      accent: "",
    }),
    raw: (w) => w.staticCost,
    goodDirection: "down",
  },
  {
    id: "prices.whatIfSpot",
    label: m.statistics_prices_tile_spot,
    explain: m.statistics_prices_tile_spot_explain,
    compute: (w, f) => ({
      value: f.money(w.spotCost),
      sub: m.statistics_prices_sub_spot(),
      accent: "",
    }),
    raw: (w) => w.spotCost,
    goodDirection: "down",
  },
  {
    id: "prices.whatIfDelta",
    label: m.statistics_prices_tile_delta,
    explain: m.statistics_prices_tile_delta_explain,
    compute: (w, f) => ({
      value: f.money(w.delta),
      sub:
        w.delta < 0
          ? m.statistics_prices_sub_delta_cheaper()
          : m.statistics_prices_sub_delta_pricier(),
      accent: goodIf(w.delta < 0),
    }),
    raw: (w) => w.delta,
    goodDirection: "down",
  },
];

/** A tile with no delta chip: nothing to diff a lifetime figure against. */
const lifetimeTile = (
  id: string,
  label: () => string,
  explain: () => string,
  compute: TileDef<AmortisationResponse>["compute"],
): TileDef<AmortisationResponse> => ({
  id,
  label,
  explain,
  compute,
  raw: () => null,
  goodDirection: "neutral",
});

/** A lifetime figure as a per-year average over the elapsed (solar or calendar)
 *  years; null before a full day has passed, as the server's `annualRate` is. */
const perYear = (a: AmortisationResponse, lifetime: number): number | null =>
  a.annualRate === null || a.elapsedYears <= 0 ? null : lifetime / a.elapsedYears;

/** A lifetime figure per CALENDAR year — for quantities that do not follow
 *  the sun (the house's consumption); null before a full day has passed. */
const perCalendarYear = (a: AmortisationResponse, lifetime: number): number | null =>
  a.annualRate === null || a.elapsedDays <= 0 ? null : (lifetime / a.elapsedDays) * 365.25;

/** The per-period tiles' sub-line: which clock spread the figure, and from when. */
const sinceLabel = (a: AmortisationResponse, since: string): string =>
  a.weighting === "solar"
    ? m.amortisation_sub_since_seasonal({ date: dateLabel(since) })
    : m.amortisation_sub_since({ date: dateLabel(since) });

/**
 * Under a full year every annualised figure is a projection from a partial
 * season, seasonal weighting or not — say so on the tile and grey it, so a
 * confident-looking payback date on a plant three months old is read as the
 * estimate it is.
 */
const projected = (a: AmortisationResponse): boolean => a.elapsedDays < 365;
/** `base`, with the projection note appended while the year is incomplete. */
const withProjection = (a: AmortisationResponse, base: string): string =>
  projected(a) ? `${base} · ${m.amortisation_sub_projected({ days: a.elapsedDays })}` : base;
/** Greyed while projected; `accent` otherwise. */
const projectedAccent = (a: AmortisationResponse, accent = ""): string =>
  projected(a) ? "text-muted-foreground" : accent;

/** An ISO instant or `YYYY-MM-DD` day as a formatted calendar date. */
const dateLabel = (iso: string): string =>
  dayMonthYear(iso.length === 10 ? dayKeyDate(iso) : new Date(iso));

/**
 * The amortisation section: what the plant cost against what its lifetime
 * counters say it saved, and when the two meet. The investment tiles gate on
 * `configured`; the savings tiles show regardless, since the counters are
 * there whether or not anyone typed a price.
 */
export const AMORTISATION_TILES: readonly TileDef<AmortisationResponse>[] = [
  lifetimeTile(
    "amortisation.invested",
    m.amortisation_tile_invested,
    m.amortisation_tile_invested_explain,
    (a, f) =>
      a.configured
        ? {
            value: f.money(a.investment.totalCost),
            sub: a.investment.commissionedOn
              ? m.amortisation_sub_commissioned({ date: dateLabel(a.investment.commissionedOn) })
              : m.amortisation_sub_not_dated(),
            accent: "",
          }
        : null,
  ),
  lifetimeTile(
    "amortisation.savings",
    m.amortisation_tile_savings,
    m.amortisation_tile_savings_explain,
    (a, f) => ({
      value: f.money(a.savings),
      sub: m.amortisation_sub_savings({
        imported: f.money(a.importSavings),
        exported: f.money(a.exportEarnings),
      }),
      accent: goodIf(a.savings > 0),
    }),
  ),
  lifetimeTile(
    "amortisation.progress",
    m.amortisation_tile_progress,
    m.amortisation_tile_progress_explain,
    (a, f) =>
      a.progress === null || a.remaining === null
        ? null
        : {
            value: f.pct(a.progress),
            sub: a.paidOff
              ? m.amortisation_sub_paid_off()
              : m.amortisation_sub_remaining({ amount: f.money(a.remaining) }),
            accent: goodIf(a.paidOff),
          },
  ),
  lifetimeTile(
    "amortisation.payback",
    m.amortisation_tile_payback,
    m.amortisation_tile_payback_explain,
    (a) =>
      a.paybackYears === null
        ? null
        : {
            value: a.paidOff
              ? m.amortisation_value_paid_off()
              : a.paybackDate
                ? dateLabel(a.paybackDate)
                : "—",
            sub: withProjection(
              a,
              m.amortisation_sub_payback_years({ years: decimal(a.paybackYears, 1) }),
            ),
            accent: projectedAccent(a, goodIf(a.paidOff)),
          },
  ),
  lifetimeTile(
    "amortisation.yearlyRate",
    m.amortisation_tile_yearly_rate,
    m.amortisation_tile_yearly_rate_explain,
    (a, f) =>
      a.annualRate === null || a.since === null
        ? null
        : {
            value: f.money(a.annualRate),
            sub: withProjection(a, sinceLabel(a, a.since)),
            accent: projectedAccent(a),
          },
  ),
  lifetimeTile(
    "amortisation.monthlyRate",
    m.amortisation_tile_monthly_rate,
    m.amortisation_tile_monthly_rate_explain,
    (a, f) =>
      a.annualRate === null || a.since === null
        ? null
        : {
            value: f.money(a.annualRate / 12),
            sub: withProjection(a, sinceLabel(a, a.since)),
            accent: projectedAccent(a),
          },
  ),
  lifetimeTile(
    "amortisation.yearlyExport",
    m.amortisation_tile_yearly_export,
    m.amortisation_tile_yearly_export_explain,
    (a, f) => {
      const earnings = perYear(a, a.exportEarnings);
      const kwh = perYear(a, a.lifetime.exportKwh);
      return earnings === null || kwh === null
        ? null
        : {
            value: f.money(earnings),
            sub: withProjection(a, m.amortisation_sub_yearly_export({ energy: f.kwh(kwh) })),
            accent: projectedAccent(a),
          };
    },
  ),
  lifetimeTile(
    "amortisation.selfConsumed",
    m.amortisation_tile_self_consumed,
    m.amortisation_tile_self_consumed_explain,
    // Per year like its neighbours once a rate exists, against the house's
    // consumption per year (when the plant meters it); before the first full
    // day only the lifetime totals can be shown.
    (a, f) => {
      const yearly = perYear(a, a.lifetime.selfConsumedKwh);
      // Consumption is not solar-shaped, so it is annualised by the calendar
      // even when the solar figure beside it is weighted by season — or a
      // summer-only history would report a house that barely consumes.
      const load = perCalendarYear(a, a.lifetime.loadKwh);
      if (yearly === null) {
        return {
          value: f.kwh(a.lifetime.selfConsumedKwh),
          sub: m.amortisation_sub_exported({ energy: f.kwh(a.lifetime.exportKwh) }),
          accent: "",
        };
      }
      const of =
        load !== null && load > 0
          ? m.amortisation_sub_of_consumption({ energy: f.kwh(load) })
          : m.amortisation_sub_yearly_export({
              energy: f.kwh(perYear(a, a.lifetime.exportKwh) ?? 0),
            });
      return { value: f.kwh(yearly), sub: withProjection(a, of), accent: projectedAccent(a) };
    },
  ),
];
