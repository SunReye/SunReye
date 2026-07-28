<script lang="ts">
	// Where the rest of today's forecast PV is planned to go: served to the house,
	// stored, sold, or lost. Stacked, because the four bands are a decomposition
	// of one total (forecast PV) rather than four things to compare — the stack
	// height *is* the PV curve.
	import { curveMonotoneX } from 'd3-shape';
	import DecisionChart, { type PlotSeries } from './decision-chart.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { PlanRow } from './plan-series';

	let { rows }: { rows: PlanRow[] } = $props();

	// Three validated hues for the three useful destinations; curtailment is
	// neutral ink, because lost energy is an absence, not another identity.
	const series: PlotSeries[] = [
		{
			key: 'loadKw',
			label: m.automations_series_load(),
			color: 'var(--color-energy-selfused)',
			unit: 'kW',
			fill: 0.75,
			width: 0
		},
		{
			key: 'chargeKw',
			label: m.automations_plan_series_charge(),
			color: 'var(--color-energy-battery)',
			unit: 'kW',
			fill: 0.75,
			width: 0
		},
		{
			key: 'exportKw',
			label: m.automations_series_export(),
			color: 'var(--color-energy-export)',
			unit: 'kW',
			fill: 0.75,
			width: 0
		},
		{
			key: 'curtailedKw',
			label: m.automations_plan_series_curtailed(),
			color: 'var(--color-muted-foreground)',
			unit: 'kW',
			fill: 0.35,
			width: 0
		}
	];

	// The stack's total is forecast PV, so the y range has to come from that —
	// left to itself the chart scales to the tallest single *band* and the stack
	// then draws straight out of the plot box.
	const yMax = $derived(Math.max(1, ...rows.map((r) => r.pvKw)) * 1.05);

	// The total and the plateau are context for the hovered slot, not extra bands.
	const tooltipExtras: PlotSeries[] = [
		{
			key: 'pvKw',
			label: m.automations_series_pv(),
			color: 'var(--color-energy-solar)',
			unit: 'kW'
		},
		{
			key: 'thresholdKw',
			label: m.automations_series_plateau(),
			color: 'var(--color-muted-foreground)',
			unit: 'kW'
		}
	];
</script>

<DecisionChart
	{rows}
	{series}
	{tooltipExtras}
	curve={curveMonotoneX}
	height="h-56"
	layout="stack"
	yDomain={[0, yMax]}
/>
