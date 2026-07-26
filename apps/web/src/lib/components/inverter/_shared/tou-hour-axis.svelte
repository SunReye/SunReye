<script lang="ts">
	// The hour tick labels below the TOU timeline. Only shown on a real clock axis;
	// the first and last labels pull inside the track so they don't overhang it.
	let {
		show,
		hourTicks
	}: {
		show: boolean;
		hourTicks: readonly number[];
	} = $props();

	const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
</script>

{#if show}
	<div class="relative h-4 text-[10px] text-muted-foreground">
		{#each hourTicks as h (h)}
			<span
				class="absolute -translate-x-1/2 tabular-nums first:translate-x-0 last:-translate-x-full"
				style="left: {(h / 24) * 100}%"
			>
				{hourLabel(h)}
			</span>
		{/each}
	</div>
{/if}
