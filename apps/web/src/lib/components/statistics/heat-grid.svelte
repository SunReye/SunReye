<script lang="ts">
	// The grid itself, split out of hour-weekday-heatmap so that panel keeps only
	// the metric switcher and the two empty states. Renders nothing but cells:
	// every "is there anything to show" decision belongs to the caller.
	//
	// Canvas layer: a 24×7 Cell grid renders far more cheaply than SVG and
	// sidesteps the >24-band INP freeze (see forecast-chart.svelte).
	import { Axis, Canvas, Cell, Chart, Tooltip } from 'layerchart/canvas';
	import { scaleBand } from 'd3-scale';
	import GradientLegend from '$lib/components/inverter/_shared/gradient-legend.svelte';
	import {
		heatColor,
		heatGradient,
		heatKwh,
		heatOpacity,
		hourLabel,
		weekdayLabel,
		type HeatPoint
	} from '$lib/statistics/heatmap';
	import { heatPaddingFor, xTickSpacingFor } from '$lib/cost/ranges';
	import * as m from '$lib/paraglide/messages';

	let {
		points,
		peak,
		weekdays,
		metricLabel
	}: {
		/** One entry per (hour, weekday) slot the window covered. */
		points: HeatPoint[];
		/** The window's busiest slot — the top of the colour ramp. */
		peak: number;
		/** ISO weekdays present, ascending; the y domain. */
		weekdays: number[];
		/** Names the metric in the tooltip row. */
		metricLabel: string;
	} = $props();

	const hours = Array.from({ length: 24 }, (_, i) => i);

	// Row height, so a window covering two weekdays is a two-row strip rather
	// than two very tall cells.
	const gridHeight = $derived(Math.min(224, weekdays.length * 26 + 40));

	// The gutters follow the plot's MEASURED width, not a breakpoint: this chart
	// renders full-bleed on one page and inside a two-up grid on another, so only
	// the element knows how much room it got. 0 until it is in the document,
	// which heatPaddingFor reads as the desktop case.
	let plotWidth = $state(0);
</script>

<!-- `band` mode gives every cell its own hit rect, which doubles as the hover
     highlight: the rects sit in an SVG overlay above the canvas and layerchart
     only sets `fill: transparent` at zero specificity, so a wash of the
     foreground colour lands exactly on the cell under the pointer. -->
<div
	style="height: {gridHeight}px"
	class="[&_.lc-tooltip-rect:hover]:fill-foreground/10"
	bind:clientWidth={plotWidth}
	aria-hidden="true"
>
	<Chart
		data={points}
		x="hod"
		xScale={scaleBand()}
		xDomain={hours}
		y="dow"
		yScale={scaleBand()}
		yDomain={weekdays}
		padding={heatPaddingFor(plotWidth)}
		tooltipContext={{ mode: 'band' }}
	>
		<Canvas>
			<Cell
				x="hod"
				y="dow"
				fill={(d: HeatPoint) => heatColor(d.avg / peak)}
				fillOpacity={(d: HeatPoint) => heatOpacity(d.avg / peak)}
				insets={{ all: 1 }}
				rx={2}
			/>
			<Axis placement="bottom" tickSpacing={xTickSpacingFor(plotWidth)} format={hourLabel} rule={false} />
			<Axis placement="left" format={weekdayLabel} rule={false} />
		</Canvas>

		<Tooltip.Root>
			{#snippet children({ data }: { data: HeatPoint })}
				<Tooltip.Header>
					{weekdayLabel(data.dow)}
					{hourLabel(data.hod)}
				</Tooltip.Header>
				<Tooltip.List>
					<Tooltip.Item label={metricLabel} value={heatKwh(data.avg)} />
				</Tooltip.List>
			{/snippet}
		</Tooltip.Root>
	</Chart>
</div>

<GradientLegend
	label={m.statistics_heatmap_legend()}
	low={heatKwh(0)}
	high={heatKwh(peak)}
	gradient={heatGradient()}
/>
