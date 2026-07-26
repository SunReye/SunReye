<script lang="ts">
	// The weather tile's content, rendered either as a dialog trigger (when there's a
	// forecast to chart) or inside a plain, non-interactive card. All structural
	// nodes are spans so the interactive variant is a valid <button>.
	import type { Component } from 'svelte';
	import MapPin from 'phosphor-svelte/lib/MapPin';
	import WeatherTileAside from './weather-tile-aside.svelte';
	import type { SolarForecast } from './weather';

	let {
		Icon,
		tempText,
		condition,
		place,
		forecast,
		radiationText
	}: {
		/** Condition icon, or null before the first payload lands. */
		Icon: Component | null;
		/** Rounded temperature with its unit suffix. */
		tempText: string;
		/** Condition text; empty when the forecast figures take its place. */
		condition: string;
		/** Configured plant location; empty when unset. */
		place: string;
		forecast: SolarForecast | null;
		radiationText: string | null;
	} = $props();
</script>

<!-- Icon + temperature/location stay grouped so the forecast can drop to its
     own row below lg instead of colliding with the temperature at ~320px. -->
<span class="flex min-w-0 items-center gap-4">
	<span
		class="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 2xl:size-16"
	>
		{#if Icon}
			<Icon class="size-7 text-primary 2xl:size-9" weight="duotone" />
		{/if}
	</span>
	<span class="flex min-w-0 flex-col gap-0.5">
		<span class="text-3xl font-semibold tabular-nums leading-none 2xl:text-4xl">
			{tempText}
		</span>
		{#if condition}
			<span class="truncate text-sm text-muted-foreground">{condition}</span>
		{/if}
		{#if place}
			<span class="flex items-center gap-1 truncate text-xs text-muted-foreground">
				<MapPin class="size-3 shrink-0" />
				{place}
			</span>
		{/if}
	</span>
</span>
<WeatherTileAside {forecast} {radiationText} />
