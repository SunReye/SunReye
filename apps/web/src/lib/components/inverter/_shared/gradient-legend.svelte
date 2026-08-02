<script lang="ts">
	// Legend row for a continuous colour scale (heatmaps, correction grids): a
	// caption, the ramp as a gradient bar, and the value at each end. Shared so
	// every canvas Cell grid explains its colours the same way.
	let {
		label,
		low,
		high,
		gradient
	}: {
		/** What the ramp encodes, e.g. "Average". */
		label: string;
		/** Already-formatted value at the pale end. */
		low: string;
		/** Already-formatted value at the deep end. */
		high: string;
		/** CSS `background` for the bar — a left-to-right gradient. */
		gradient: string;
	} = $props();
</script>

<div class="flex items-center gap-2 text-xs text-muted-foreground">
	<span>{label}</span>
	<span class="tabular-nums">{low}</span>
	<span class="h-2 w-24 rounded-full" style="background: {gradient}"></span>
	<span class="tabular-nums">{high}</span>
</div>
