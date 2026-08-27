<script lang="ts">
	// Clock-axis chrome drawn inside the timeline box: the hour gridlines and the
	// "now" marker. Both only make sense on a real 00:00→24:00 axis, so both are off
	// together when the timeline falls back to equal-width index blocks.
	//
	// Rendered before the period blocks so the gridlines sit under them; the marker
	// carries z-10 and so still paints above.
	let {
		show,
		hourTicks,
		nowMin,
		minutesPerDay
	}: {
		show: boolean;
		/** Hours to rule, e.g. [0, 6, 12, 18, 24]. */
		hourTicks: readonly number[];
		/** Minutes since local midnight. */
		nowMin: number;
		minutesPerDay: number;
	} = $props();
</script>

{#if show}
	<!-- hour gridlines -->
	{#each hourTicks as h (h)}
		<div class="absolute inset-y-0 w-px bg-border/60" style="left: {(h / 24) * 100}%"></div>
	{/each}
	<!-- now marker -->
	<div
		class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-foreground/70"
		style="left: {(nowMin / minutesPerDay) * 100}%"
	>
		<span
			class="absolute -top-0.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-foreground/70"
		></span>
	</div>
{/if}
