<script lang="ts">
	// The thin ratio meter between an energy card's two KPI rows. Cards that never
	// fill the ratio slot render an empty track, so every card keeps the same height.
	import { Skeleton } from '$lib/components/ui/skeleton';

	let {
		loading,
		trackClass,
		barClass,
		fillPercent
	}: {
		/** This card uses the ratio slot, but the figures haven't arrived yet. */
		loading: boolean;
		/** Track background — empty on cards without a ratio. */
		trackClass: string;
		/** Fill colour, matching the card's accent. */
		barClass: string;
		/** Fill width 0–100, or `undefined` for no fill. */
		fillPercent: number | undefined;
	} = $props();
</script>

<span class="block h-1 overflow-hidden rounded-full {trackClass}">
	{#if loading}
		<Skeleton class="h-full w-full rounded-full" />
	{:else if fillPercent !== undefined}
		<span
			class={`block h-full rounded-full ${barClass}`}
			style={`width:${fillPercent}%;transition:width 700ms ease`}
		></span>
	{/if}
</span>
