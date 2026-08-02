<script lang="ts">
	import type { PeriodEnergy } from 'server/src/energy-calc';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import EnergySplitChart from '$lib/components/inverter/energy-split-chart.svelte';
	import EnergySeriesChart from '$lib/components/statistics/energy-series-chart.svelte';
	import RatioTrendChart from '$lib/components/statistics/ratio-trend-chart.svelte';
	import HourWeekdayHeatmap from '$lib/components/statistics/hour-weekday-heatmap.svelte';
	import { costFormatters } from '$lib/cost/format';
	import { specQuery } from '$lib/cost/ranges';
	import type { SectionData } from '$lib/statistics/sections';
	import { sectionScope } from '$lib/statistics/chart-scope.svelte';
	import { statisticsLive } from '$lib/statistics-live.svelte';
	import { ENERGY_TILES, type EnergyTileData } from '$lib/statistics/tiles';
	import ChartPanel from './chart-panel.svelte';
	import StatTiles from './stat-tiles.svelte';

	const DAY = 86_400_000;

	// Energy analytics: how much came in, went out and stayed on-site — in tiles
	// first (the everyday "how much did we produce last month?" question), then in
	// the three charts and the hour×weekday heatmap below them.
	// Props are the shared bag every section body takes; `previous` is the same
	// window one reference period back (null when it predates recorded history).
	let { data }: { data: SectionData } = $props();
	const cost = $derived(data.cost);
	const previous = $derived(data.previous);
	const range = $derived(data.range);

	// Ephemeral per-viewer choice, seeded from the saved preference.
	const view = sectionScope('energy', () => range);

	// One series fetch for all three charts below: the split, the ratio trend and
	// the raw flows all read the same periods at the section's chosen scope.
	let series = $state<PeriodEnergy[]>([]);
	$effect(() => {
		// Shared invalidation signal: a live push on a now-inclusive wider range
		// bumps it (at most once a minute), which refetches the series in place.
		void statisticsLive.revision;
		const query = specQuery(view.spec);
		let cancelled = false;
		api.api.energy.series.get({ query }).then(({ data: payload }) => {
			if (cancelled) return;
			series = (payload ?? []) as PeriodEnergy[];
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

	const tileData = $derived<EnergyTileData>({
		current: cost,
		previous,
		rangeDays,
		hasBattery
	});

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

<StatTiles defs={ENERGY_TILES} data={tileData} {formatters} />

{#if hasSeries}
	<!-- Split, ratios and raw flows all read the one fetch above, so the scope
	     switcher in this header moves every chart in the section at once. -->
	<ChartPanel title={m.statistics_energy_flows()} {view} {range} switcher>
		<EnergySeriesChart periods={series} bucket={view.spec.bucket} {showBattery} />
	</ChartPanel>

	<EnergySplitChart chart={view.spec} caption={view.caption} periods={series} />

	{#if hasRatios}
		<ChartPanel title={m.statistics_energy_ratios()} {view} {range}>
			<RatioTrendChart periods={series} bucket={view.spec.bucket} />
		</ChartPanel>
	{/if}
{/if}

<!-- Rangeless-by-scope: the heatmap always folds the PICKED window (not the
     chart scope) onto one week, and hides itself when that window has no data. -->
<HourWeekdayHeatmap from={range.from} to={range.to} />
