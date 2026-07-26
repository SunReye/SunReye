<script lang="ts">
	// One series row inside a `Chart.Tooltip` formatter: colour swatch, series name,
	// right-aligned formatted value. Shared by the bar charts so their tooltips stay
	// identical (cost-bar-chart / hourly-bar-chart).

	/** The subset of the tooltip payload item the swatch needs. */
	type SwatchItem = { config?: { color?: string } | undefined; color?: string | undefined };

	let {
		item,
		name,
		value
	}: {
		/** Tooltip payload item; its config colour wins over the raw series colour. */
		item: SwatchItem;
		/** Series name as handed to the formatter snippet. */
		name: unknown;
		/** Already-formatted value text (money, unit suffix, …). */
		value: string;
	} = $props();

	const color = $derived(item.config?.color ?? item.color);
</script>

<div class="size-2.5 shrink-0 rounded-xs" style="background: {color}"></div>
<div class="flex flex-1 items-center justify-between gap-4 leading-none">
	<span class="text-muted-foreground">{name}</span>
	<span class="font-mono font-medium tabular-nums text-foreground">
		{value}
	</span>
</div>
