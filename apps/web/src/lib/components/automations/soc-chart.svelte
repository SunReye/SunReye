<script lang="ts">
	// The state-of-charge track: where the battery has been and where the plan
	// expects it to go. One measure, one axis, one hue — the past is solid, the
	// projection dashed, so provenance never rests on colour.
	import { curveMonotoneX } from 'd3-shape';
	import DecisionChart, { type PlotSeries } from './decision-chart.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { SocRow } from './plan-series';

	let { rows }: { rows: SocRow[] } = $props();

	const series: PlotSeries[] = [
		{
			key: 'socPct',
			label: m.automations_soc_measured(),
			color: 'var(--color-energy-battery)',
			unit: '%'
		},
		{
			key: 'planSocPct',
			label: m.automations_soc_projected(),
			color: 'var(--color-energy-battery)',
			unit: '%',
			dash: '5 4'
		}
	];
</script>

<DecisionChart {rows} {series} curve={curveMonotoneX} height="h-44" yDomain={[0, 100]} />
