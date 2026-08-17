<script lang="ts">
	// The live value in a metric card's header: animated figure with its unit, or an
	// em dash until the first sample lands.
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';

	let {
		value,
		unit,
		animate = true
	}: {
		value: number | undefined;
		unit: string;
		/** Passed straight through: false snaps the figure instead of gliding it. */
		animate?: boolean;
	} = $props();

	const suffix = $derived(unit ? ` ${unit}` : '');
</script>

<span class="shrink-0 font-mono text-sm tabular-nums text-foreground">
	{#if value === undefined}
		—
	{:else}
		<AnimatedNumber {value} {unit} {animate} />{suffix}
	{/if}
</span>
