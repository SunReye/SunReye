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
	import * as m from '$lib/paraglide/messages';

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

	const hasData = $derived(slots.some((s) => s.predictedW > 0 || (s.actualW ?? 0) > 0));

	// Crop to daylight, padded by an hour each side and snapped to full hours so
	// the axis ticks stay on round times.
	const view = $derived.by(() => {
		const perHour = Math.max(1, Math.round(60 / stepMinutes));
		const live = (s: ForecastSlot | undefined) =>
			(s?.predictedW ?? 0) > 0 || (s?.actualW ?? 0) > 0;
		const first = slots.findIndex((s) => live(s));
		if (first === -1) return slots;
		let last = slots.length - 1;
		while (last > first && !live(slots[last])) last--;
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

	const config: Chart.ChartConfig = Object.fromEntries(
		series.map((s) => [s.key, { label: s.label, color: s.color }])
	);

	// The hovered-band highlight. In the SVG charts this comes from the
	// `.lc-highlight-area` CSS rule (a translucent currentColor wash), but the
	// canvas renderer can't read that rule and falls back to an opaque fill —
	// an ugly solid bar. Feed it a concrete colour (the resolved foreground,
	// read off the mounted container) at a low opacity so it matches the other
	// charts' subtle band.
	let wrapEl = $state<HTMLDivElement | null>(null);
	const highlightFill = $derived(wrapEl ? getComputedStyle(wrapEl).color : 'oklch(0.556 0 0)');
</script>

{#if hasData}
	<div class="flex min-w-0 flex-col gap-3" bind:this={wrapEl}>
		<Chart.Container {config} class="h-64 w-full min-w-0">
			<BarChart
				data={view}
				x="label"
				{series}
				seriesLayout="overlap"
				bandPadding={0.15}
				padding={{ top: 8, right: 8, bottom: 20, left: 40 }}
				props={{ xAxis: { ticks: 7 } }}
				highlight={{ area: { fill: highlightFill, fillOpacity: 0.1 } }}
			>
				{#snippet tooltip()}
					<ForecastTooltip {stepMinutes} />
				{/snippet}
			</BarChart>
		</Chart.Container>
		<ChartLegend items={legend} />
	</div>
{:else}
	<div class="flex h-64 items-center justify-center text-sm text-muted-foreground">{empty}</div>
{/if}
