<script lang="ts">
	import type { PeriodEnergy } from '@SunReye/contracts/energy';
	import PeriodSeriesChart from './period-series-chart.svelte';
	import { periodKeyLabel, type CostBucket } from '$lib/cost/ranges';
	import * as m from '$lib/paraglide/messages';

	// The two ratios that say how much of the household runs on its own energy
	// (self-sufficiency) and how much of its own energy it keeps
	// (self-consumption), period by period. Both are shares, so they share one
	// 0–100% axis — no second scale, and the two lines compare directly.
	let {
		periods,
		bucket,
		onZoom,
		onResetZoom,
		zoomed = false
	}: {
		periods: PeriodEnergy[];
		bucket: CostBucket;
	/** Forwarded to the line chart: a drag selects positions, and the section
	 *  answers by refetching that window at a finer bucket. */
	onZoom?: (indices: [number, number]) => void;
	onResetZoom?: () => void;
	zoomed?: boolean;
	} = $props();

	type Row = { label: string; selfSufficiency: number | null; selfConsumption: number | null };

	const data = $derived<Row[]>(
		periods.map((p) => ({
			label: periodKeyLabel(p.bucket, bucket),
			selfSufficiency: p.selfSufficiency,
			selfConsumption: p.selfConsumption
		}))
	);

	// Hues follow the energy-split chart: green = energy served on-site,
	// blue = energy that went to the grid side.
	const series = [
		{
			key: 'selfSufficiency',
			label: m.costs_tile_self_sufficiency(),
			color: 'var(--color-energy-selfused)',
			value: (d: Row) => d.selfSufficiency
		},
		{
			key: 'selfConsumption',
			label: m.costs_tile_self_consumption(),
			color: 'var(--color-energy-export)',
			value: (d: Row) => d.selfConsumption
		}
	];

	// A period with no load (or no production) reports null rather than 0% — an
	// em-dash says "not measurable", which a zero would misstate.
	const pct = (v: unknown) =>
		v === null || v === undefined ? '—' : `${Math.round(Number(v) * 100)}%`;
</script>

<!-- `overlay`: two shares compared on one plot. A share is not accrued over its
     bucket — it varies through it — so the line is the honest mark here, and the
     two are unfilled because overlapping translucent fills mix into a third
     colour that belongs to neither. -->
<PeriodSeriesChart
	{data}
	{series}
	kind="overlay"
	format={pct}
	yDomain={[0, 1]}
	{onZoom}
	{onResetZoom}
	{zoomed}
/>
