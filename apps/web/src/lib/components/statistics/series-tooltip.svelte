<script lang="ts">
	// The tooltip every statistics chart hands to layerchart: one formatted row
	// per hovered series. Charts differ in their marks, not in how a value reads,
	// so they pass this as their `tooltip` snippet rather than repeating it.
	import * as Chart from '$lib/components/ui/chart';
	import TooltipSeriesRow from '$lib/components/inverter/_shared/tooltip-series-row.svelte';

	let { format }: { format: (v: number) => string } = $props();
</script>

<Chart.Tooltip>
	{#snippet formatter({ value, name, item })}
		<TooltipSeriesRow {item} {name} value={format(Number(value))} />
	{/snippet}
</Chart.Tooltip>
