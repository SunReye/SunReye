<script lang="ts">
	// The live value in a metric card's header: animated figure with its unit, or an
	// em dash until the first sample lands.
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';

	let {
		value,
		unit
	}: {
		value: number | undefined;
		unit: string;
	} = $props();

	const suffix = $derived(unit ? ` ${unit}` : '');
</script>

<span class="shrink-0 font-mono text-sm tabular-nums text-foreground">
	{#if value === undefined}
		—
	{:else}
		<AnimatedNumber {value} {unit} />{suffix}
	{/if}
</span>
