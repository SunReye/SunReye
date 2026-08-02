// Tile registry for the statistics page. Pure data + functions so every tile
// derivation is unit-testable without mounting a component; the route's
// stat-tiles.svelte renders whatever a registry yields for the current
// payload. Later sections (energy, prices, records) add their own registries
// against the same TileDef surface.

import type { CostBreakdown } from "server/src/cost-calc";
import type { CostFormatters } from "$lib/cost/format";
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

/** One resolved, render-ready tile. */
export type Tile = { id: string; label: string; explain: string } & TileView;

/** Resolve a registry against one payload, dropping non-applicable tiles. */
export function deriveTiles<Data>(
  defs: readonly TileDef<Data>[],
  data: Data,
  f: CostFormatters,
): Tile[] {
  return defs.flatMap((def) => {
    const view = def.compute(data, f);
    return view ? [{ id: def.id, label: def.label(), explain: def.explain(), ...view }] : [];
  });
}
