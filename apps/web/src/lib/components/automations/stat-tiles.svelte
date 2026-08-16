<script lang="ts">
	// Hairline-divided stat tiles: label in muted ink, value in foreground. The
	// PV tile animates from the 1 Hz live sample; the rest ride the stream tick.
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';
	import { animatable, formatReading, type Reading } from '$lib/live/plant';
	import * as m from '$lib/paraglide/messages';

	let {
		pv,
		tiles
	}: {
		/** Canonical PV power (W) off the metrics topic, with its freshness. */
		pv: Reading;
		tiles: { label: string; value: string; sub: string | null }[];
	} = $props();

	// Only a current reading is allowed to glide: an animation is a claim that
	// the number is still being measured. A stale one is shown as text with its
	// marker, an absent one as an em dash.
	const glide = $derived(animatable(pv));
	const fmtKw = (w: number) => `${(w / 1000).toFixed(1)} kW`;
</script>

<div class="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
	<div class="flex flex-col gap-1 bg-background p-3">
		<span class="text-xs text-muted-foreground">{m.peak_shaving_status_pv()}</span>
		<span class="text-xl font-semibold tabular-nums tracking-tight">
			{#if glide != null}
				<AnimatedNumber value={glide / 1000} unit="kW" />
				<span class="text-sm font-normal text-muted-foreground">kW</span>
			{:else}
				<span class="text-muted-foreground">{formatReading(pv, fmtKw, m.live_reading_stale())}</span>
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
