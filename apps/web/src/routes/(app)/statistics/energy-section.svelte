<script lang="ts">
	import { source } from '$lib/source.svelte';
	import type { BatteryHealth, PeriodEnergy } from '@SunReye/contracts/energy';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import EnergySplitChart from '$lib/components/inverter/energy-split-chart.svelte';
	import EnergySeriesChart from '$lib/components/statistics/energy-series-chart.svelte';
	import RatioTrendChart from '$lib/components/statistics/ratio-trend-chart.svelte';
	import HourWeekdayHeatmap from '$lib/components/statistics/hour-weekday-heatmap.svelte';
	import { costFormatters } from '$lib/cost/format';
	import { specQuery, type CostBucket } from '$lib/cost/ranges';
	import { zoomedChartSpec } from '$lib/charts/zoom-range';
	import { zoomLabelOptions } from '$lib/charts/zoom.svelte';
	import type { SectionData } from '$lib/statistics/sections';
	import { sectionScope } from '$lib/statistics/chart-scope.svelte';
	import { baselineLabel, deltaFor } from '$lib/statistics/compare';
	import { statisticsLive } from '$lib/statistics-live.svelte';
	import { ENERGY_TILES, type EnergyTileData } from '$lib/statistics/tiles';
	import BatteryHealthPanel from './battery-health-panel.svelte';
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
	// the raw flows all read the same periods at the section's chosen scope —
	// paired with the granularity they were fetched at, updated together (as in
	// cost-section). Switching scope changes the spec before the response lands,
	// and labelling day-keyed periods as months threw on an invalid date.
	let series = $state<{ periods: PeriodEnergy[]; bucket: CostBucket }>({
		periods: [],
		bucket: view.spec.bucket
	});
	$effect(() => {
		// Shared invalidation signal: a live push on a now-inclusive wider range
		// bumps it (at most once a minute), which refetches the series in place.
		void statisticsLive.revision;
		const query = { ...specQuery(view.spec), ...source.query };
		let cancelled = false;
		api.api.energy.series.get({ query }).then(({ data: payload }) => {
			if (cancelled) return;
			series = { periods: (payload ?? []) as PeriodEnergy[], bucket: query.bucket };
		});
		return () => {
			cancelled = true;
		};
	});

	// The period keys the plotted rows were built from, in the order the bands
	// sit in. A drag hands back POSITIONS (a 24-month axis repeats "Aug"), and
	// these are what turn a position back into a window.
	const periodKeys = $derived(series.periods.map((p) => p.bucket));

	// A zoom narrows the spec the effect above fetches, so selecting a week of a
	// month chart comes back BY HOUR rather than as six magnified daily bars.
	const zoomTo = (indices: [number, number]) =>
		view.zoomTo(zoomedChartSpec(view.spec, periodKeys, indices, zoomLabelOptions()));
	const clearZoom = () => view.zoomTo(null);

	const formatters = $derived(costFormatters(cost.currency));

	// Whole days in the picked window, floored at 1 so a part-day window never
	// inflates the per-day averages.
	const rangeDays = $derived(
		Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / DAY))
	);

	const hasBattery = $derived(inverter.capabilities?.battery ?? false);

	// Measured pack capacity and SOH. Fetched ONCE, not per window: these are
	// properties of the battery, not of the picked range, and re-fetching them on
	// every zoom would issue a query per drag for two numbers that cannot have
	// changed. Null until it arrives — and null is also the answer on a plant the
	// server cannot measure (no SOC role, too few deep discharges), which the
	// tiles render as absent rather than as a healthy-looking placeholder.
	let health = $state<BatteryHealth | null>(null);
	$effect(() => {
		if (!hasBattery) return;
		let cancelled = false;
		void api.api.battery.health.get().then(({ data: got }) => {
			if (!cancelled) health = got ?? null;
		});
		return () => {
			cancelled = true;
		};
	});

	const tileData = $derived<EnergyTileData>({
		current: cost,
		previous,
		rangeDays,
		hasBattery,
		health
	});

	// Same shape one reference window back, so every energy tile carries its
	// change. Null previous → no chip payload at all, rather than a fabricated
	// zero baseline.
	const previousTileData = $derived<EnergyTileData | null>(
		previous ? { current: previous, previous: null, rangeDays, hasBattery, health } : null
	);
	const baseline = $derived(baselineLabel(data.mode, data.windowDays));

	// Capability gate for the battery lines: the pack exists, or the window moved
	// energy through one. Never two permanently-flat series.
	const showBattery = $derived(
		hasBattery || series.periods.some((p) => p.batteryChargeKwh > 0 || p.batteryDischargeKwh > 0)
	);

	// A window with no energy at all has nothing to plot; the tiles above still
	// state the zeroes honestly.
	const hasSeries = $derived(series.periods.some((p) => p.loadKwh > 0 || p.productionKwh > 0));
	// Ratios only exist where there was load / production to divide by.
	const hasRatios = $derived(
		series.periods.some((p) => p.selfSufficiency !== null || p.selfConsumption !== null)
	);

	// Headline figure per chart, with the same comparison the tiles carry:
	// production for the flows, self-sufficiency for the ratios.
	const flowsSummary = $derived({
		value: formatters.kwh(cost.productionKwh),
		delta: deltaFor(cost.productionKwh, previous?.productionKwh ?? null),
		goodDirection: 'up' as const,
		baseline
	});
	const ratioSummary = $derived({
		value: formatters.pct(cost.selfSufficiency),
		delta: deltaFor(cost.selfSufficiency, previous?.selfSufficiency ?? null),
		goodDirection: 'up' as const,
		baseline
	});
	// The split chart shows both ratios as its own averages, so it takes the
	// deltas rather than one panel summary.
	const splitDeltas = $derived({
		selfSufficiency: deltaFor(cost.selfSufficiency, previous?.selfSufficiency ?? null),
		selfConsumption: deltaFor(cost.selfConsumption, previous?.selfConsumption ?? null),
		baseline
	});
</script>

<StatTiles
	defs={ENERGY_TILES}
	data={tileData}
	previous={previousTileData}
	{baseline}
	{formatters}
/>

{#if hasSeries}
	<!-- Split, ratios and raw flows all read the one fetch above, so the scope
	     switcher in this header moves every chart in the section at once. -->
	<ChartPanel title={m.statistics_energy_flows()} {view} switcher={range} summary={flowsSummary}>
		<EnergySeriesChart
			periods={series.periods}
			bucket={series.bucket}
			{showBattery}
			onZoom={zoomTo}
			onResetZoom={clearZoom}
			zoomed={view.zoomed}
		/>
	</ChartPanel>

	<EnergySplitChart
		caption={view.caption}
		periods={series.periods}
		bucket={series.bucket}
		deltas={view.scope === 'detail' ? splitDeltas : undefined}
	/>

	{#if hasRatios}
		<ChartPanel title={m.statistics_energy_ratios()} {view} summary={ratioSummary}>
			<RatioTrendChart
				periods={series.periods}
				bucket={series.bucket}
				onZoom={zoomTo}
				onResetZoom={clearZoom}
				zoomed={view.zoomed}
			/>
		</ChartPanel>
	{/if}
{/if}

<BatteryHealthPanel {health} {hasBattery} />

<!-- Rangeless-by-scope: the heatmap always folds the PICKED window (not the
     chart scope) onto one week, and hides itself when that window has no data. -->
<HourWeekdayHeatmap from={range.from} to={range.to} />
