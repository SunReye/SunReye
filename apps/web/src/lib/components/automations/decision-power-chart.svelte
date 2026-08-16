<script lang="ts">
	// The power plane the automation is steering: PV and house load as context,
	// the export the decision implies, the charging it asks for, and the plateau
	// it holds them at. Measured export/charging ride along in the tooltip, so a
	// shadow run can be checked against what the plant actually did.
	import { curveMonotoneX } from 'd3-shape';
	import { CHART_BOX } from '$lib/layout/tokens';
	import DecisionChart, { type PlotSeries } from './decision-chart.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { DecisionRow } from './decision-series';

	let { rows, showLoad }: { rows: DecisionRow[]; showLoad: boolean } = $props();

	// Hues are the app's energy tokens (validated as a set for this plot); the
	// plateau is a reference line, so it stays neutral ink instead of taking a
	// categorical slot.
	const series = $derived<PlotSeries[]>([
		{
			key: 'pvKw',
			label: m.automations_series_pv(),
			color: 'var(--color-energy-solar)',
			unit: 'kW',
			fill: 0.2
		},
		...(showLoad
			? [
					{
						key: 'loadKw',
						label: m.automations_series_load(),
						color: 'var(--color-energy-selfused)',
						unit: 'kW',
						dash: '5 4'
					} satisfies PlotSeries
				]
			: []),
		{
			// Line, not a fill: two translucent fills overlapping (PV over export)
			// mix into a muddy third colour that belongs to neither series.
			key: 'exportKw',
			label: m.automations_series_export(),
			color: 'var(--color-energy-export)',
			unit: 'kW'
		},
		{
			key: 'batteryKw',
			label: m.automations_series_battery(),
			color: 'var(--color-energy-battery)',
			unit: 'kW'
		},
		{
			key: 'thresholdKw',
			label: m.automations_series_plateau(),
			color: 'var(--color-muted-foreground)',
			unit: 'kW',
			dash: '2 3',
			width: 1.5
		}
	]);

	// Measured counterparts keep their entity's hue — same thing, actually observed.
	const tooltipExtras: PlotSeries[] = [
		{
			key: 'measuredExportKw',
			label: m.automations_series_export_measured(),
			color: 'var(--color-energy-export)',
			unit: 'kW'
		},
		{
			key: 'measuredChargeKw',
			label: m.automations_series_charge_measured(),
			color: 'var(--color-energy-battery)',
			unit: 'kW'
		}
	];
</script>

<DecisionChart {rows} {series} {tooltipExtras} curve={curveMonotoneX} height={CHART_BOX} />
