<script module lang="ts">
	// 15-minute solar-forecast chart for the weather-tile dialog. Same
	// LayerChart + chart-container idioms as hourly-bar-chart so it reads like
	// the other detail charts, but with a forecast-specific tooltip (peak power
	// + energy per slot) and the plotted window cropped to daylight so ~96
	// quarter-hour bands aren't squeezed by hours of guaranteed-zero night.
	export type ForecastSlot = {
		/** Slot start as a plant-local clock label, e.g. "13:15". */
		label: string;
		/** Forecast average AC power over the slot, W (usable, after clipping). */
		predictedW: number;
		/** Forecast peak AC power within the slot, W (usable, after clipping). */
		predictedPeakW: number;
		/** Uncurtailed forecast average, W; equals `predictedW` when nothing clips. */
		predictedRawW: number;
		/** Uncurtailed forecast peak, W. */
		predictedRawPeakW: number;
		/** Measured average AC power over the slot, W; null when not yet measured. */
		actualW: number | null;
		/** Measured peak AC power within the slot, W; null when unavailable. */
		actualPeakW: number | null;
	};
</script>

<script lang="ts">
	// Canvas render context: ~96 quarter-hour bands × 2 series in the SVG
	// context mount slowly enough to freeze weak devices for seconds (measured
	// INP ~3 s vs ~90 ms for the 24-band dialogs); canvas draws the same marks
	// without the per-band DOM.
	import { BarChart } from 'layerchart/canvas';
	import * as Chart from '$lib/components/ui/chart';
	import ChartLegend from '$lib/components/inverter/chart-legend.svelte';
	import ForecastTooltip from './forecast-tooltip.svelte';
	import { seriesConfig } from './_shared/chart-series';
	import { canvasHighlight } from './_shared/canvas-highlight.svelte';
	import * as m from '$lib/paraglide/messages';
	import { fittedPadding } from '$lib/charts/plot-padding';
	import { CHART_BOX } from '$lib/layout/tokens';

	// This chart's own gutters — a one-decimal kW figure on the left, the last
	// hour label's overhang on the right — narrowed on a phone but never widened
	// to the cost family's desktop pair.
	const PADDING = { top: 8, right: 8, bottom: 20, left: 40 };

	// Followed from the plot's MEASURED width rather than a breakpoint: this
	// chart renders inside a dialog whose width the viewport does not give away.
	let plotWidth = $state(0);

	let {
		slots,
		stepMinutes,
		empty
	}: {
		/** One entry per slot, spanning the local day (index 0 = 00:00). */
		slots: ForecastSlot[];
		stepMinutes: number;
		/** Empty-state copy when every slot is zero. */
		empty: string;
	} = $props();

	// A slot carries data when either the forecast or the measured series is above
	// zero; `actualW` is null for slots in the future.
	const slotW = (s: ForecastSlot) => Math.max(s.predictedW, s.actualW ?? 0);
	const isLive = (s: ForecastSlot | undefined) => s !== undefined && slotW(s) > 0;

	const hasData = $derived(slots.some(isLive));

	// Crop to daylight, padded by an hour each side and snapped to full hours so
	// the axis ticks stay on round times.
	const view = $derived.by(() => {
		const perHour = Math.max(1, Math.round(60 / stepMinutes));
		const first = slots.findIndex(isLive);
		if (first === -1) return slots;
		let last = slots.length - 1;
		while (last > first && !isLive(slots[last])) last--;
		const from = Math.floor(Math.max(0, first - perHour) / perHour) * perHour;
		const to = Math.min(slots.length, Math.ceil((last + 1 + perHour) / perHour) * perHour);
		return slots.slice(from, to);
	});

	// Overlaid on the same band, back to front: the full uncapped potential,
	// the (opaque) usable forecast covering its lower part — leaving the
	// curtailed slice visible as a split top — and the solid measured bar in
	// front. Actual only exists up to now, so past slots compare the series and
	// future slots show the forecast alone. Values are average kW per slot —
	// directly comparable across the series.
	const series = [
		{
			key: 'uncapped',
			label: m.weather_forecast_uncapped(),
			color: 'color-mix(in srgb, var(--color-energy-selfused) 45%, transparent)',
			value: (d: ForecastSlot) => Math.max(d.predictedRawW, d.predictedW) / 1000
		},
		{
			key: 'predicted',
			label: m.weather_forecast_predicted(),
			// Mixed with the background rather than transparent so it occludes
			// the uncapped bar behind it up to the usable level.
			color: 'color-mix(in srgb, var(--color-energy-export) 35%, var(--background))',
			value: (d: ForecastSlot) => d.predictedW / 1000
		},
		{
			key: 'actual',
			label: m.weather_forecast_actual(),
			color: 'var(--color-energy-solar)',
			value: (d: ForecastSlot) => (d.actualW ?? 0) / 1000
		}
	];
	// Whether clipping visibly bites anywhere in the plotted window — gates the
	// uncapped legend entry so unclipped days keep the familiar two-swatch row.
	const hasClipping = $derived(view.some((s) => s.predictedRawW > s.predictedW + 1));
	// Legend swatches keep the solid series hue (the mixes are a rendering
	// nicety, not a different identity).
	const legend = $derived([
		...(hasClipping
			? [
					{
						key: 'uncapped',
						label: m.weather_forecast_uncapped(),
						color: 'var(--color-energy-selfused)'
					}
				]
			: []),
		{ key: 'predicted', label: m.weather_forecast_predicted(), color: 'var(--color-energy-export)' },
		{ key: 'actual', label: m.weather_forecast_actual(), color: 'var(--color-energy-solar)' }
	]);

	const config = seriesConfig(series);

	// Canvas can't read the `.lc-highlight-area` CSS wash; see canvasHighlight.
	const highlight = canvasHighlight();
</script>

{#if hasData}
	<div class="flex min-w-0 flex-col gap-3" bind:this={highlight.el} bind:clientWidth={plotWidth}>
		<Chart.Container {config} class="{CHART_BOX} w-full min-w-0">
			<BarChart
				data={view}
				x="label"
				{series}
				seriesLayout="overlap"
				bandPadding={0.15}
				padding={fittedPadding(PADDING, plotWidth)}
				props={{ xAxis: { ticks: 7 } }}
				highlight={{ area: { fill: highlight.fill, fillOpacity: 0.1 } }}
			>
				{#snippet tooltip()}
					<ForecastTooltip {stepMinutes} />
				{/snippet}
			</BarChart>
		</Chart.Container>
		<ChartLegend items={legend} />
	</div>
{:else}
	<div class="flex {CHART_BOX} items-center justify-center text-sm text-muted-foreground">{empty}</div>
{/if}
