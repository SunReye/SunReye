<script lang="ts">
	// The charge-current ceiling over the same window: what the automation decided
	// against what the register actually held. Step curve, because a ceiling is
	// piecewise constant between writes — and in shadow mode the two lines
	// diverging is exactly the point.
	import DecisionChart, { type PlotSeries } from './decision-chart.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { DecisionRow } from './decision-series';

	let { rows, showRegister }: { rows: DecisionRow[]; showRegister: boolean } = $props();

	// The decided ceiling keeps the battery hue it has in the power chart (same
	// entity, same colour); the register readback is neutral ink plus a dash, so it
	// reads as "what is actually in there", not a third measure.
	const series = $derived<PlotSeries[]>([
		{
			key: 'targetA',
			label: m.automations_series_target(),
			color: 'var(--color-energy-battery)',
			unit: 'A'
		},
		...(showRegister
			? [
					{
						key: 'registerA',
						label: m.automations_series_register(),
						color: 'var(--color-muted-foreground)',
						unit: 'A',
						// Not the primary measurement: this is what the register reads
						// back, beside what the automation decided.
						dash: 'secondary'
					} satisfies PlotSeries
				]
			: [])
	]);
</script>

<DecisionChart {rows} {series} kind="setpoint" height="h-40" yDomain={[0, null]} />
