<script lang="ts">
	import { getChartContext } from 'layerchart';
	import ChartTooltipRoot from '$lib/charts/chart-tooltip-root.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { ForecastSlot } from './forecast-chart.svelte';
	import {
		type TooltipRowKey,
		kwLabel,
		kwhLabel,
		slotEndLabel,
		tooltipRows
	} from './forecast-tooltip-rows';

	// Tooltip body for the solar-forecast chart. Chart.Tooltip's formatter only
	// hands each series its own value; the peak-power / energy readout needs the
	// whole hovered row, so this reads it straight from the layerchart tooltip
	// context (same primitive chart-tooltip.svelte builds on). The row shape and
	// formatting live in the pure ./forecast-tooltip-rows helper; this file only
	// binds each row to its localized name and colour.
	let { stepMinutes }: { stepMinutes: number } = $props();

	const ctx = getChartContext();
	const slot = $derived(ctx.tooltip.data as ForecastSlot | null);

	const endLabel = $derived(slot ? slotEndLabel(slot.label, stepMinutes) : '');

	const meta: Record<TooltipRowKey, { name: () => string; color: string }> = {
		predicted: { name: m.weather_forecast_predicted, color: 'var(--color-energy-export)' },
		uncapped: { name: m.weather_forecast_uncapped, color: 'var(--color-energy-selfused)' },
		actual: { name: m.weather_forecast_actual, color: 'var(--color-energy-solar)' }
	};

	const rows = $derived(slot ? tooltipRows(slot) : []);
</script>

<ChartTooltipRoot variant="none">
	{#if slot}
		<div
			class="grid min-w-[12rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl"
		>
			<div class="font-medium tabular-nums">{slot.label} – {endLabel}</div>
			<div class="grid gap-1.5">
				{#each rows as row (row.key)}
					<div class="flex w-full items-center gap-2">
						<div class="size-2.5 shrink-0 rounded-[2px]" style="background: {meta[row.key].color}"></div>
						<div class="flex flex-1 items-center justify-between gap-4 leading-none">
							<span class="text-muted-foreground">{meta[row.key].name()}</span>
							<span class="font-mono font-medium tabular-nums text-foreground">
								{kwLabel(row.avgW)}
								<span class="font-sans font-normal text-muted-foreground">
									{m.weather_forecast_avg()}
								</span>
							</span>
						</div>
					</div>
					<div class="flex justify-end leading-none">
						<span class="font-mono tabular-nums text-muted-foreground">
							{kwLabel(row.peakW)}
							<span class="font-sans">{m.weather_forecast_max()}</span>
							· {kwhLabel(row.avgW, stepMinutes)}
						</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</ChartTooltipRoot>
