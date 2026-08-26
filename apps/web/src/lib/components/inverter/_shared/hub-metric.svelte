<script lang="ts">
	// One figure on the hub's pill: a glidden value with its unit suffix and a
	// caption under it. Extracted so the pill itself is a list rather than three
	// copies of the same block.
	import type { Component } from 'svelte';
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';

	let {
		value,
		unit,
		caption,
		valueClass,
		icon
	}: {
		value: number;
		/** Unit for the readout's formatting AND the suffix beside it. */
		unit: string;
		caption: string;
		/** Colour/weight of the number — the pill's own emphasis decision. */
		valueClass: string;
		/** Optional glyph before the number (the efficiency gauge). */
		icon?: Component;
	} = $props();

	const Icon = $derived(icon);
</script>

<div class="flex flex-col items-center whitespace-nowrap">
	<span class={`flex items-center gap-0.5 text-sm tabular-nums 2xl:text-base ${valueClass}`}>
		{#if Icon}
			<Icon class="size-3" weight="duotone" />
		{/if}
		<AnimatedNumber {value} {unit} /><span
			class="ml-0.5 text-[0.6rem] font-normal text-muted-foreground">{unit}</span
		>
	</span>
	<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">{caption}</span>
</div>
