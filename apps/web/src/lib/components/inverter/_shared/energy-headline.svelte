<script lang="ts">
	// The kWh headline of an energy card: animated figure plus a smaller unit
	// suffix, or a skeleton until the first sample arrives over the WebSocket.
	import { Skeleton } from '$lib/components/ui/skeleton';
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';

	let {
		value,
		unit
	}: {
		value: number | undefined;
		unit: string | null | undefined;
	} = $props();

	const suffix = $derived(unit ?? '');
</script>

<span class="text-2xl font-semibold tabular-nums leading-none xl:text-3xl">
	{#if value === undefined}
		<Skeleton class="h-7 w-20 rounded xl:h-8" />
	{:else}
		<AnimatedNumber {value} unit={suffix} />
		<span class="ml-1 text-sm font-normal text-muted-foreground 2xl:text-base">
			{suffix}
		</span>
	{/if}
</span>
