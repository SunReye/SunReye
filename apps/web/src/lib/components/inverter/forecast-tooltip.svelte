<script lang="ts">
	import { getChartContext, Tooltip as TooltipPrimitive } from 'layerchart';
	import * as m from '$lib/paraglide/messages';
	import type { ForecastSlot } from './forecast-chart.svelte';

	// Tooltip body for the solar-forecast chart. Chart.Tooltip's formatter only
	// hands each series its own value; the peak-power / energy readout needs the
	// whole hovered row, so this reads it straight from the layerchart tooltip
	// context (same primitive chart-tooltip.svelte builds on).
	let { stepMinutes }: { stepMinutes: number } = $props();

	const ctx = getChartContext();
	const slot = $derived(ctx.tooltip.data as ForecastSlot | null);

	// Slot end for the "13:15 – 13:30" header, derived from the label so the
	// last slot of the day correctly reads 24:00.
	const endLabel = $derived.by(() => {
		if (!slot) return '';
		const t = Number(slot.label.slice(0, 2)) * 60 + Number(slot.label.slice(3, 5)) + stepMinutes;
		return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
	});

	const kw = (w: number) =>
		`${(w / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kW`;
	const kwh = (w: number) =>
		`${((w * stepMinutes) / 60 / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`;

	// Older samples predate per-slot peak tracking, so fall back to the average.
	const actualPeakW = (s: ForecastSlot) => s.actualPeakW ?? s.actualW ?? 0;

	const rows = $derived.by(() => {
		if (!slot) return [];
		const out = [
			{
				key: 'predicted',
				name: m.weather_forecast_predicted(),
				color: 'var(--color-energy-export)',
				peakW: slot.predictedPeakW,
				avgW: slot.predictedW
			}
		];
		// Only slots where clipping actually bites get the uncapped row — on an
		// unclipped slot it would duplicate the predicted numbers.
		if (slot.predictedRawW > slot.predictedW + 1) {
			out.push({
				key: 'uncapped',
				name: m.weather_forecast_uncapped(),
				color: 'var(--color-energy-selfused)',
				peakW: slot.predictedRawPeakW,
				avgW: slot.predictedRawW
			});
		}
		if (slot.actualW !== null) {
			out.push({
				key: 'actual',
				name: m.weather_forecast_actual(),
				color: 'var(--color-energy-solar)',
				peakW: actualPeakW(slot),
				avgW: slot.actualW
			});
		}
		return out;
	});
</script>

<TooltipPrimitive.Root variant="none">
	{#if slot}
		<div
			class="grid min-w-[12rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl"
		>
			<div class="font-medium tabular-nums">{slot.label} – {endLabel}</div>
			<div class="grid gap-1.5">
				{#each rows as row (row.key)}
					<div class="flex w-full items-center gap-2">
						<div class="size-2.5 shrink-0 rounded-[2px]" style="background: {row.color}"></div>
						<div class="flex flex-1 items-center justify-between gap-4 leading-none">
							<span class="text-muted-foreground">{row.name}</span>
							<span class="font-mono font-medium tabular-nums text-foreground">
								{kw(row.peakW)}
								<span class="font-sans font-normal text-muted-foreground">
									{m.weather_forecast_max()}
								</span>
							</span>
						</div>
					</div>
					<div class="flex justify-end leading-none">
						<span class="font-mono tabular-nums text-muted-foreground">{kwh(row.avgW)}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</TooltipPrimitive.Root>
