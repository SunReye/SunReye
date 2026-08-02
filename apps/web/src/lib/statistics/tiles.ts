// Tile registry for the statistics page. Pure data + functions so every tile
// derivation is unit-testable without mounting a component; the route's
// stat-tiles.svelte renders whatever a registry yields for the current
// payload. Later sections (energy, prices, records) add their own registries
// against the same TileDef surface.

import type { CostBreakdown, CostTotals } from "server/src/cost-calc";
import type { RecordsResponse } from "server/src/statistics";
import type { DayRecord } from "server/src/statistics-calc";
import type { CostFormatters } from "$lib/cost/format";
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
   * Stable id, namespaced "section.tile" — the customize preferences (later
   * wave) hide tiles by this id, so it must not change once shipped.
   */
  id: string;
  label: () => string;
  explain: () => string;
  /** Format the tile for one payload; `null` omits it entirely (capability
   *  gating — e.g. §51 never cost this plant anything). */
  compute: (data: Data, f: CostFormatters) => TileView | null;
  /**
   * The unformatted headline figure for the same payload. Not rendered yet:
   * the comparison wave diffs it across periods for the delta chips.
   */
  raw: (data: Data) => number | null;
  /** Which delta direction is good for the household; drives future chip color. */
  goodDirection: "up" | "down" | "neutral";
};

/** Tiles turn green only when the figure is in the household's favour. */
const goodIf = (favourable: boolean): string => (favourable ? "text-emerald-500" : "");

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
        c.selfConsumedKwh > 0
          ? `${f.kwh(c.selfConsumedKwh)} × ${f.price(c.solarSavings / c.selfConsumedKwh)}`
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
};

/** Signed percentage change against the reference window, e.g. "▲ 8%". Null
 *  when there is nothing meaningful to compare against (no reference window, a
 *  zero baseline, or a change under half a percent). */
function pctDelta(current: number, previous: number | null): string | null {
  if (previous === null || previous === 0) return null;
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return null;
  return `${change > 0 ? "▲" : "▼"} ${Math.abs(Math.round(change * 100))}%`;
}

/** Sub-line shared by every energy tile: the daily average, plus the delta
 *  against the reference window when one exists. */
function perDaySub(kwh: number, d: EnergyTileData, previous: number | null, f: CostFormatters) {
  const amount = f.kwh(kwh / d.rangeDays);
  const delta = pctDelta(kwh, previous);
  return delta
    ? m.statistics_sub_per_day_delta({ amount, delta })
    : m.statistics_sub_per_day({ amount });
}

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
        sub: perDaySub(kwh, d, d.previous ? value(d.previous) : null, f),
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
    (t) => t.selfConsumedKwh,
    "up",
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
];

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
const recordDay = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

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
