<script lang="ts">
	import type { PeriodEnergy } from 'server/src/energy-calc';
	import PeriodLineChart from './period-line-chart.svelte';
	import { periodLabel, type CostBucket } from '$lib/cost/ranges';
	import * as m from '$lib/paraglide/messages';

	// The two ratios that say how much of the household runs on its own energy
	// (self-sufficiency) and how much of its own energy it keeps
	// (self-consumption), period by period. Both are shares, so they share one
	// 0–100% axis — no second scale, and the two lines compare directly.
	let { periods, bucket }: { periods: PeriodEnergy[]; bucket: CostBucket } = $props();

	type Row = { label: string; selfSufficiency: number | null; selfConsumption: number | null };

	const data = $derived<Row[]>(
		periods.map((p) => ({
			label: periodLabel(p.bucket, bucket),
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

<PeriodLineChart {data} {series} {bucket} format={pct} yDomain={[0, 1]} />
