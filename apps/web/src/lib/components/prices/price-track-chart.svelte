<script lang="ts">
	// Canvas render context: today + tomorrow at quarter-hour resolution is ~192
	// bands, far past the point where the SVG context freezes weak devices for
	// seconds (measured INP ~3 s vs ~90 ms at 24 bands, see forecast-chart).
	// Canvas draws the same marks without the per-band DOM.
	import { BarChart } from 'layerchart/canvas';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import PriceTooltip from './price-tooltip.svelte';
	import { seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import { canvasHighlight } from '$lib/components/inverter/_shared/canvas-highlight.svelte';
	import type { PriceRow } from '$lib/prices/price-series';
	import * as m from '$lib/paraglide/messages';

	let { rows }: { rows: PriceRow[] } = $props();

	// Two series so the bars diverge around zero (same technique as the cost
	// chart): exactly one is non-zero per band, so the axis crosses at zero
	// without a forced domain.
	//
	// Colours are taken from the existing validated set rather than adding a hue.
	// The positive half is the neutral reference grey the automation charts use
	// for "context, not the subject"; the negative half borrows the battery
	// magenta on purpose — a negative slot is precisely when the pack should be
	// absorbing, so the colour link carries meaning instead of being arbitrary.
	const series = [
		{
			key: 'positiveCt',
			label: m.prices_series_price(),
			color: 'var(--color-muted-foreground)',
			value: (d: PriceRow) => d.positiveCt
		},
		{
			key: 'negativeCt',
			label: m.prices_series_negative(),
			color: 'var(--color-energy-battery)',
			value: (d: PriceRow) => d.negativeCt
		}
	];

	const config = seriesConfig(series);

	// Canvas can't read the `.lc-highlight-area` CSS wash; see canvasHighlight.
	const highlight = canvasHighlight();

	// Only label the legend's negative swatch when something is actually
	// negative, so an ordinary day keeps a one-swatch row.
	const legend = $derived(
		rows.some((r) => r.negative) ? series : series.filter((s) => s.key === 'positiveCt')
	);
</script>

<div class="flex min-w-0 flex-col gap-3" bind:this={highlight.el}>
	<Chart.Container {config} class="h-64 w-full min-w-0">
		<BarChart
			data={rows}
			x="label"
			{series}
			seriesLayout="stackDiverging"
			bandPadding={0.1}
			padding={{ top: 8, right: 8, bottom: 20, left: 44 }}
			props={{ xAxis: { ticks: 8 } }}
			highlight={{ area: { fill: highlight.fill, fillOpacity: 0.1 } }}
		>
			{#snippet tooltip()}
				<PriceTooltip />
			{/snippet}
		</BarChart>
	</Chart.Container>
	<ChartLegend items={legend} />
</div>
