<script lang="ts">
	// Hairline-divided stat tiles: label in muted ink, value in foreground. The
	// PV tile animates from the 1 Hz live sample; the rest ride the stream tick.
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		livePvW,
		tiles
	}: {
		livePvW: number | null | undefined;
		tiles: { label: string; value: string; sub: string | null }[];
	} = $props();
</script>

<div class="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
	<div class="flex flex-col gap-1 bg-background p-3">
		<span class="text-xs text-muted-foreground">{m.peak_shaving_status_pv()}</span>
		<span class="text-xl font-semibold tabular-nums tracking-tight">
			{#if livePvW != null}
				<AnimatedNumber value={livePvW / 1000} unit="kW" />
				<span class="text-sm font-normal text-muted-foreground">kW</span>
			{:else}
				—
			{/if}
		</span>
	</div>
	{#each tiles as tile (tile.label)}
		<div class="flex flex-col gap-1 bg-background p-3">
			<span class="truncate text-xs text-muted-foreground">{tile.label}</span>
			<span class="text-xl font-semibold tabular-nums tracking-tight">{tile.value}</span>
			{#if tile.sub}
				<span class="text-xs text-muted-foreground">{tile.sub}</span>
			{/if}
		</div>
	{/each}
</div>
