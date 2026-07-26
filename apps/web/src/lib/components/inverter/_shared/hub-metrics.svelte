<script lang="ts">
	// The metric pill floating above the inverter hub: conversion efficiency and the
	// inverter's own draw (conversion losses + standby). Sits on a translucent
	// backdrop so connector rails can pass underneath without colliding with text.
	import GaugeIcon from 'phosphor-svelte/lib/Gauge';
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';
	import * as msg from '$lib/paraglide/messages';

	let {
		efficiency,
		selfUse
	}: {
		/** Percent; hidden at zero, which means "not computable right now". */
		efficiency: number | undefined;
		/** Watts, signed. */
		selfUse: number | undefined;
	} = $props();

	const hasEfficiency = $derived(efficiency !== undefined && efficiency > 0);
	const hasSelfUse = $derived(selfUse !== undefined);
	const show = $derived(hasEfficiency || hasSelfUse);
</script>

{#if show}
	<div
		class="absolute bottom-full left-1/2 mb-2.5 flex -translate-x-1/2 justify-center gap-4 rounded-xl border border-border/60 bg-background/85 px-3 py-1.5 leading-tight backdrop-blur-[2px]"
	>
		{#if hasEfficiency}
			<div class="flex flex-col items-center whitespace-nowrap">
				<span
					class="flex items-center gap-0.5 text-sm font-semibold tabular-nums text-primary 2xl:text-base"
				>
					<GaugeIcon class="size-3" weight="duotone" />
					<AnimatedNumber value={efficiency as number} unit="%" />%
				</span>
				<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
					{msg.flow_efficiency()}
				</span>
			</div>
		{/if}
		{#if hasSelfUse}
			<div class="flex flex-col items-center whitespace-nowrap">
				<span class="text-sm font-medium tabular-nums 2xl:text-base">
					<AnimatedNumber value={Math.abs(selfUse as number)} unit="W" /><span
						class="ml-0.5 text-[0.6rem] font-normal text-muted-foreground">W</span
					>
				</span>
				<span class="text-[0.6rem] uppercase tracking-wide text-muted-foreground">
					{msg.flow_self_use()}
				</span>
			</div>
		{/if}
	</div>
{/if}
