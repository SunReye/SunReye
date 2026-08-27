<script lang="ts" module>
	/** One stacked series of the block; `value` reads it off a labelled period. */
	export type SplitSeries<Row> = {
		key: string;
		label: string;
		color: string;
		value: (d: Row) => number;
	};
</script>

<script lang="ts" generics="Row extends { label: string }">
	// One side of the energy split: a titled stacked bar chart with the window's
	// average ratio (and its change) in the header. Extracted from
	// energy-split-chart so the two sides share one definition and neither
	// template grows past reading size.
	import { BarChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import * as msg from '$lib/paraglide/messages';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import DeltaChip from '$lib/components/statistics/delta-chip.svelte';
	import PlotFrame from '$lib/components/layout/plot-frame.svelte';
	import { seriesConfig, stackedBarProps } from '$lib/components/inverter/_shared/chart-series';
	import { CHART_BOX_SHORT } from '$lib/layout/tokens';

	// The gutters follow the plot's MEASURED width, not a breakpoint: the two
	// halves of the split sit side by side on a laptop and stack on a phone, so
	// only the element knows how much room it got. Per instance, not module-level:
	// both halves render this component. 0 until it is in the document, which
	// stackedBarProps reads as the desktop case.
	let plotWidth = $state(0);

	let {
		title,
		subtitle,
		series,
		data,
		seriesLayout,
		ratio,
		delta,
		baseline
	}: {
		title: string;
		subtitle: string;
		series: SplitSeries<Row>[];
		data: Row[];
		/** 'stack' for kWh, 'stackExpand' for the 100%-normalized share. */
		seriesLayout: 'stack' | 'stackExpand';
		/** Window average of the ratio this side describes; null when there was
		 *  no flow to divide by. */
		ratio: number | null;
		/** Change of that ratio against the reference window. Undefined hides the
		 *  chip — the chart is not plotting the picked window. */
		delta?: number | null;
		baseline?: string;
	} = $props();

	const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
	const config = $derived(seriesConfig(series));
</script>

<!-- min-w-0 lets the grid column shrink below the chart's intrinsic width;
     without it the block overflows the section edge on narrow screens. -->
<div class="flex min-w-0 flex-col gap-3" bind:clientWidth={plotWidth}>
	<div class="flex items-baseline justify-between gap-3">
		<div class="flex flex-col">
			<h3 class="text-sm font-medium">{title}</h3>
			<span class="text-xs text-muted-foreground">{subtitle}</span>
		</div>
		<span
			class="flex shrink-0 items-baseline gap-2 whitespace-nowrap text-sm tabular-nums text-muted-foreground"
		>
			<span>
				{msg.chart_avg()} <span class="font-semibold text-foreground">{pct(ratio)}</span>
			</span>
			{#if delta !== undefined}
				<DeltaChip {delta} goodDirection="up" {baseline} />
			{/if}
		</span>
	</div>
	<!-- The height stays on this wrapper, not on the frame: `CHART_BOX_SHORT` is
	     what sizes the plot, and a frame carrying its own height would be a second
	     one in the chain EXPANDED_SECTION walks. The frame's job here is only to
	     be the positioning box the corner control anchors to — no gesture on this
	     chart, so no `chips`.

	     One ⤢ per BLOCK, which means two in the energy-split card, both expanding
	     it. That is the honest reading of "the control sits on the plot": the card
	     is a single box holding two plots, the reader's pointer is over one of
	     them, and the corner they can see is the one they press. Framing only the
	     left block instead would leave the right block's corner permanently dead
	     with no way to tell why, and putting it back in the header cluster is the
	     mispress against the collapse caret this whole change removes. -->
	<div class="{CHART_BOX_SHORT} w-full">
		<PlotFrame>
			<Chart.Container {config} class="aspect-auto h-full w-full">
				<BarChart
					{data}
					x="label"
					{series}
					{seriesLayout}
					{...stackedBarProps(data.length, plotWidth)}
				>
					{#snippet tooltip()}
						<Chart.Tooltip />
					{/snippet}
				</BarChart>
			</Chart.Container>
		</PlotFrame>
	</div>
	<ChartLegend items={series} />
</div>
