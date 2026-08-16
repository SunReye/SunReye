<script lang="ts">
	import { onMount } from 'svelte';
	// Canvas layer: a 12×~15 Cell grid renders far more cheaply than SVG and
	// sidesteps the >24-band INP freeze (see forecast-chart.svelte).
	import { Axis, Canvas, Cell, Chart, Tooltip } from 'layerchart/canvas';
	import { scaleBand } from 'd3-scale';
	import { api } from '$lib/api';
	import GradientLegend from '$lib/components/inverter/_shared/gradient-legend.svelte';
	import { fittedPadding } from '$lib/charts/plot-padding';
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	// Mirrors the server's ForecastCorrectionView (apps/server/src/forecast/forecast-correction-job.ts).
	type CorrectionCell = { month: number; hour: number; factor: number; weight: number };
	type CorrectionView = {
		enabled: boolean;
		learnedThrough: string | null;
		skill: { maeRaw: number; maeCorrected: number; improvementPct: number; samples: number };
		cells: CorrectionCell[];
	};

	let view = $state<CorrectionView | null>(null);

	onMount(async () => {
		const { data } = await api.api.forecast.correction.get();
		if (data) view = data as CorrectionView;
	});

	// The hour span that actually carries data (daylight varies by latitude/season,
	// so a fixed 0–23 grid would be mostly empty and too wide).
	const hours = $derived.by(() => {
		const hs = view?.cells.map((c) => c.hour) ?? [];
		if (hs.length === 0) return [] as number[];
		const lo = Math.max(0, Math.min(...hs) - 1);
		const hi = Math.min(23, Math.max(...hs) + 1);
		return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
	});
	const months = Array.from({ length: 12 }, (_, i) => i + 1);
	const hourTicks = $derived(hours.filter((h) => h % 3 === 0));

	const monthLabel = (month: number) =>
		new Date(2000, month - 1, 1).toLocaleDateString(getLocale(), { month: 'short' });

	/**
	 * Diverging hue around 1.0: emerald where the plant beats the model (factor > 1,
	 * forecast boosted), amber where it underperforms (factor < 1, forecast trimmed).
	 * Confidence (sample weight) drives opacity via `fillOpacity`, so sparsely-learned
	 * cells stay pale.
	 */
	const factorColor = (factor: number) => `hsl(${factor >= 1 ? 152 : 38} 65% 45%)`;
	const confidence = (weight: number) => 0.15 + 0.85 * Math.min(1, weight / 12);

	const hasData = $derived((view?.cells.length ?? 0) > 0);

	// The grid's own gutters: a three-letter month label on the left, hour labels
	// below. Narrower than the cost charts' because a month name is not a figure.
	const PADDING = { left: 36, bottom: 24, top: 4, right: 8 };

	// Fitted to the plot's MEASURED width — this panel sits inside a settings
	// section whose width the viewport does not predict. 0 before it is in the
	// document reads as the desktop case.
	let plotWidth = $state(0);
</script>

<div class="flex flex-col gap-3">
	{#if !view}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else if !hasData}
		<p class="text-sm text-muted-foreground">{m.weather_forecast_correction_empty()}</p>
	{:else}
		<div class="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
			<span class="text-muted-foreground">{m.weather_forecast_correction_improvement()}</span>
			<span class="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
				{Math.round(view.skill.improvementPct)}%
			</span>
			<span class="text-muted-foreground tabular-nums">
				{Math.round(view.skill.samples)}
				{m.weather_forecast_correction_samples()}
			</span>
			{#if view.learnedThrough}
				<span class="text-muted-foreground">
					{m.weather_forecast_correction_learned_through()}
					{view.learnedThrough}
				</span>
			{/if}
		</div>

		<div class="h-64" bind:clientWidth={plotWidth}>
			<Chart
				data={view.cells}
				x="hour"
				xScale={scaleBand()}
				xDomain={hours}
				y="month"
				yScale={scaleBand()}
				yDomain={months}
				padding={fittedPadding(PADDING, plotWidth)}
				tooltipContext={{ mode: 'quadtree' }}
			>
				<Canvas>
					<Cell
						x="hour"
						y="month"
						fill={(d: CorrectionCell) => factorColor(d.factor)}
						fillOpacity={(d: CorrectionCell) => confidence(d.weight)}
						insets={{ all: 1 }}
						rx={2}
					/>
					<Axis placement="bottom" ticks={hourTicks} rule={false} />
					<Axis placement="left" format={(mm: number) => monthLabel(mm)} rule={false} />
				</Canvas>

				<Tooltip.Root>
					{#snippet children({ data }: { data: CorrectionCell })}
						<Tooltip.Header>
							{monthLabel(data.month)}
							{String(data.hour).padStart(2, '0')}:00
						</Tooltip.Header>
						<Tooltip.List>
							<Tooltip.Item label="×" value={data.factor.toFixed(2)} />
						</Tooltip.List>
					{/snippet}
				</Tooltip.Root>
			</Chart>
		</div>

		<GradientLegend
			label={m.weather_forecast_correction_legend()}
			low="0.6×"
			high="1.4×"
			gradient="linear-gradient(to right, hsl(38 65% 45% / 0.85), hsl(0 0% 50% / 0.15), hsl(152 65% 45% / 0.85))"
		/>
	{/if}
</div>
