<script lang="ts">
	// The historical area chart of a single metric. Signed metrics (battery/grid
	// power) split the fill red above / green below a zero baseline; unsigned ones
	// get a vertical gradient fading to transparent.
	import { AreaChart, Area, LinearGradient } from 'layerchart';
	import { curveCatmullRom } from 'd3-shape';
	import * as Chart from '$lib/components/ui/chart';
	import DivergingArea from '$lib/components/inverter/diverging-area.svelte';
	import type { Snippet } from 'svelte';

	let {
		data,
		label,
		accent,
		diverging,
		xDomain,
		xTickFormat,
		labelFormatter,
		tooltipValue
	}: {
		/** Rollup rows carrying `date` and `avg`. */
		data: { date: Date; avg: number }[];
		label: string;
		accent: string;
		diverging: boolean;
		xDomain: [Date, Date];
		xTickFormat: (v: unknown) => string;
		labelFormatter: (v: unknown) => string;
		/** Tooltip row for the hovered value. */
		tooltipValue: Snippet<[{ value: unknown }]>;
	} = $props();

	type MarksContext = {
		context: { yScale: (v: number) => number; height: number; padding: { bottom: number } };
	};
</script>

<Chart.Container
	config={{ avg: { label, color: accent } }}
	class="aspect-auto h-full w-full"
	style="--color-primary: {accent}"
>
	<AreaChart
		{data}
		x="date"
		y="avg"
		axis
		grid
		padding={{ top: 8, right: 8, bottom: 28, left: 44 }}
		{xDomain}
		props={{ xAxis: { format: xTickFormat, ticks: 4 } }}
	>
		{#snippet marks({ context }: MarksContext)}
			{#if diverging}
				<DivergingArea {context} />
			{:else}
				<LinearGradient vertical stops={[[0, accent], [1, 'transparent']]}>
					{#snippet children({ gradient })}
						<Area
							curve={curveCatmullRom}
							line={{ stroke: accent, 'stroke-width': 1.5 }}
							fill={gradient}
							fillOpacity={0.9}
						/>
					{/snippet}
				</LinearGradient>
			{/if}
		{/snippet}
		{#snippet tooltip()}
			<Chart.Tooltip {labelFormatter} formatter={tooltipValue} />
		{/snippet}
	</AreaChart>
</Chart.Container>
