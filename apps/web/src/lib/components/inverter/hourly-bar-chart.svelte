<script lang="ts" generics="T extends { label: string }">
	import { BarChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import TooltipSeriesRow from '$lib/components/inverter/_shared/tooltip-series-row.svelte';
	import { seriesConfig } from '$lib/components/inverter/_shared/chart-series';
	import { CHART_BOX } from '$lib/layout/tokens';

	// Reusable hourly bar chart for the overview detail dialogs. One or more
	// series are stacked per band; a single series renders as a plain bar. Mirrors
	// the LayerChart + chart-container + tooltip idioms of energy-split-chart /
	// cost-bar-chart so the detail charts read the same as the Statistics ones.
	type Series = { key: string; label: string; color: string; value: (d: T) => number };

	let {
		data,
		series,
		unit,
		xTicks = 6,
		empty,
		layout = 'stack'
	}: {
		/** Rows already carrying a formatted x-axis `label` (e.g. "14:00"). */
		data: T[];
		series: Series[];
		/** Unit suffix shown in the tooltip, e.g. "kWh" or "kW". */
		unit: string;
		/** Max x-axis tick labels (layerchart thins the band to every Nth entry). */
		xTicks?: number;
		/** Empty-state copy shown when every series is all-zero. */
		empty: string;
		/** `stack` sums series per band; `overlap` draws them on the same band (later
		 *  series in front — e.g. a translucent predicted behind a solid actual). */
		layout?: 'stack' | 'overlap';
	} = $props();

	const config: Chart.ChartConfig = $derived(seriesConfig(series));

	const hasData = $derived(data.some((d) => series.some((s) => s.value(d) > 0)));
	const fmt = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
</script>

{#if hasData}
	<div class="flex min-w-0 flex-col gap-3">
		<Chart.Container {config} class="{CHART_BOX} w-full min-w-0">
			<BarChart
				{data}
				x="label"
				{series}
				seriesLayout={layout}
				bandPadding={0.2}
				stackPadding={2}
				padding={{ top: 8, right: 8, bottom: 20, left: 40 }}
				props={{ xAxis: { ticks: xTicks } }}
			>
				{#snippet tooltip()}
					<Chart.Tooltip>
						{#snippet formatter({ value, name, item })}
							<TooltipSeriesRow {item} {name} value={fmt(Number(value))} />
						{/snippet}
					</Chart.Tooltip>
				{/snippet}
			</BarChart>
		</Chart.Container>
		{#if series.length > 1}
			<ChartLegend items={series} />
		{/if}
	</div>
{:else}
	<div class="flex {CHART_BOX} items-center justify-center text-sm text-muted-foreground">{empty}</div>
{/if}
