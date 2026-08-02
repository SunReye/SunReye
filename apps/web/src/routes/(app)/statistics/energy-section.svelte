<script lang="ts">
	import { fade } from 'svelte/transition';
	import type { CostBreakdown } from 'server/src/cost-calc';
	import type { ComparisonResponse } from 'server/src/statistics';
	import type { PeriodEnergy } from 'server/src/energy-calc';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import EnergySplitChart from '$lib/components/inverter/energy-split-chart.svelte';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import EnergySeriesChart from '$lib/components/statistics/energy-series-chart.svelte';
	import RatioTrendChart from '$lib/components/statistics/ratio-trend-chart.svelte';
	import HourWeekdayHeatmap from '$lib/components/statistics/hour-weekday-heatmap.svelte';
	import { costFormatters } from '$lib/cost/format';
	import { chartSpecFor, specQuery, type ChartScope, type CostRange } from '$lib/cost/ranges';
	import { chartCaption, defaultChartScope, scopeOptions } from '$lib/statistics/chart-scope';
	import { ENERGY_TILES, type EnergyTileData } from '$lib/statistics/tiles';
	import StatTiles from './stat-tiles.svelte';

	const DAY = 86_400_000;

	// Energy analytics: how much came in, went out and stayed on-site — in tiles
	// first (the everyday "how much did we produce last month?" question), then in
	// the three charts and the hour×weekday heatmap below them.
	let {
		cost,
		range,
		/** Comparison payload from the page, when it already fetched one. Left
		 *  undefined this section fetches its own — the page-level fetch lands with
		 *  the records section, and this prop is the seam it plugs into. */
		comparison: given
	}: { cost: CostBreakdown; range: CostRange; comparison?: ComparisonResponse | null } = $props();

	// Ephemeral per-viewer choice, seeded from the saved preference.
	let scope = $state<ChartScope>(defaultChartScope('energy'));
	const spec = $derived(chartSpecFor(range, scope));
	const caption = $derived(chartCaption(range, scope));

	let fetched = $state<ComparisonResponse | null>(null);
	const comparison = $derived(given ?? fetched);

	// Tile row: the picked window against its adjacent reference window. One
	// request for both, and the same payload feeds every delta.
	$effect(() => {
		if (given !== undefined) return;
		const query = {
			from: range.from.toISOString(),
			to: range.to.toISOString(),
			mode: 'previous' as const
		};
		let cancelled = false;
		api.api.statistics.comparison.get({ query }).then(({ data }) => {
			if (cancelled) return;
			fetched = (data as ComparisonResponse) ?? null;
		});
		return () => {
			cancelled = true;
		};
	});

	// One series fetch for all three charts below: the split, the ratio trend and
	// the raw flows all read the same periods at the section's chosen scope.
	let series = $state<PeriodEnergy[]>([]);
	$effect(() => {
		const query = specQuery(spec);
		let cancelled = false;
		api.api.energy.series.get({ query }).then(({ data }) => {
			if (cancelled) return;
			series = (data ?? []) as PeriodEnergy[];
		});
		return () => {
			cancelled = true;
		};
	});

	const formatters = $derived(costFormatters(cost.currency));

	// Whole days in the picked window, floored at 1 so a part-day window never
	// inflates the per-day averages.
	const rangeDays = $derived(
		Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / DAY))
	);

	const hasBattery = $derived(inverter.capabilities?.battery ?? false);

	const tileData = $derived<EnergyTileData | null>(
		comparison
			? {
					current: comparison.current,
					previous: comparison.previous,
					rangeDays,
					hasBattery
				}
			: null
	);

	// Capability gate for the battery lines: the pack exists, or the window moved
	// energy through one. Never two permanently-flat series.
	const showBattery = $derived(
		hasBattery || series.some((p) => p.batteryChargeKwh > 0 || p.batteryDischargeKwh > 0)
	);

	// A window with no energy at all has nothing to plot; the tiles above still
	// state the zeroes honestly.
	const hasSeries = $derived(series.some((p) => p.loadKwh > 0 || p.productionKwh > 0));
	// Ratios only exist where there was load / production to divide by.
	const hasRatios = $derived(
		series.some((p) => p.selfSufficiency !== null || p.selfConsumption !== null)
	);
</script>

{#if tileData}
	<StatTiles defs={ENERGY_TILES} data={tileData} {formatters} />
{/if}

{#if hasSeries}
	<!-- Split, ratios and raw flows all read the one fetch above, so the scope
	     switcher in this header moves every chart in the section at once. -->
	<section class="flex flex-col gap-4 border border-border p-4" transition:fade={{ duration: 200 }}>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
				{m.statistics_energy_flows()} — {caption}
			</h2>
			<RangeSwitcher options={scopeOptions(range)} bind:value={scope} />
		</div>
		<EnergySeriesChart periods={series} bucket={spec.bucket} {showBattery} />
	</section>

	<EnergySplitChart chart={spec} {caption} periods={series} />

	{#if hasRatios}
		<section class="flex flex-col gap-3 border border-border p-4" transition:fade={{ duration: 200 }}>
			<h2 class="text-sm font-medium uppercase tracking-wide text-muted-foreground">
				{m.statistics_energy_ratios()} — {caption}
			</h2>
			<RatioTrendChart periods={series} bucket={spec.bucket} />
		</section>
	{/if}
{/if}

<!-- Rangeless-by-scope: the heatmap always folds the PICKED window (not the
     chart scope) onto one week, and hides itself when that window has no data. -->
<HourWeekdayHeatmap from={range.from} to={range.to} />
