<script lang="ts">
	import { getChartContext } from 'layerchart';
	import ChartTooltipRoot from '$lib/charts/chart-tooltip-root.svelte';
	import { fractionDigits } from '$lib/inverter/format';

	// Tooltip that reads each series' RAW value from the hovered datum rather than
	// the plotted value. Custom charts may normalize plotted values onto a shared
	// [0,1] scale (dual-axis mode), so the plotted value is meaningless for display
	// — the true, unit-suffixed numbers live in the datum keyed by metric key.
	let {
		series,
		labelFormatter
	}: {
		series: { key: string; label: string; color: string; unit: string }[];
		labelFormatter: (value: unknown) => string;
	} = $props();

	const ctx = getChartContext();
	const datum = $derived(ctx.tooltip.data as Record<string, number | Date> | null);
	const label = $derived(datum ? labelFormatter(ctx.x(datum)) : '');

	const unitSuffix = (unit: string) => (unit ? ` ${unit}` : '');

	const shown = $derived(
		series
			.map((s) => ({ ...s, value: datum?.[s.key] }))
			.filter((s): s is typeof s & { value: number } => typeof s.value === 'number')
			.map((s) => ({
				...s,
				text: s.value.toLocaleString(undefined, fractionDigits(s.unit)) + unitSuffix(s.unit)
			}))
	);

	const visible = $derived(datum !== null && shown.length > 0);
</script>

{#if visible}
	<ChartTooltipRoot variant="none">
		<div
			class="grid min-w-[9rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl"
		>
			<div class="font-medium">{label}</div>
			<div class="grid gap-1.5">
				{#each shown as s (s.key)}
					<div class="flex w-full items-center gap-2">
						<div
							class="size-2.5 shrink-0 rounded-[2px]"
							style="background-color: {s.color}"
						></div>
						<div class="flex flex-1 items-center justify-between gap-3 leading-none">
							<span class="text-muted-foreground">{s.label}</span>
							<span class="font-mono font-medium tabular-nums text-foreground">
								{s.text}
							</span>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</ChartTooltipRoot>
{/if}
