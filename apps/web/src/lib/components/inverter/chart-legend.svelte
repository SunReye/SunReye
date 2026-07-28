<script lang="ts">
	// Swatch legend shared by the cost / energy-split bar charts — keeps series
	// identity off color-alone (dataviz accessibility pass).
	//
	// `dash` mirrors a dashed line's stroke into the swatch: two series of the
	// same measure (measured vs projected SOC) share a hue on purpose, and then
	// the dash is the only thing telling them apart — a solid block for both
	// would make the legend carry no information at all.
	let {
		items
	}: { items: readonly { key: string; label: string; color: string; dash?: string }[] } = $props();
</script>

<div class="flex flex-wrap gap-x-4 gap-y-1">
	{#each items as s (s.key)}
		<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
			{#if s.dash}
				<span
					class="h-0.5 w-3"
					style="background: repeating-linear-gradient(to right, {s.color} 0 4px, transparent 4px 7px)"
				></span>
			{:else}
				<span class="size-2.5 rounded-xs" style="background: {s.color}"></span>
			{/if}
			{s.label}
		</span>
	{/each}
</div>
