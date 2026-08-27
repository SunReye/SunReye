<script lang="ts">
	// The metric pill floating above the inverter hub: the total DC power it
	// converts, its conversion efficiency, and its own draw (conversion losses +
	// standby). Sits on a translucent backdrop so connector rails can pass
	// underneath without colliding with text.
	import GaugeIcon from 'phosphor-svelte/lib/Gauge';
	import HubMetric from './hub-metric.svelte';
	import * as msg from '$lib/paraglide/messages';

	let {
		efficiency,
		selfUse,
		dcInput
	}: {
		/** Percent; hidden at zero, which means "not computable right now". */
		efficiency: number | undefined;
		/** Watts, signed. */
		selfUse: number | undefined;
		/**
		 * Total DC power arriving from the array, W. The hub is where it belongs:
		 * it is the sum the inverter converts, and with per-string power mapped no
		 * node carries it — the strings each show their own.
		 */
		dcInput: number | undefined;
	} = $props();

	/** The figures with a reading behind them, in reading order. A zero
	 *  efficiency means "not computable right now", so it counts as absent. */
	const shown = $derived(
		[
			dcInput === undefined
				? null
				: {
						id: 'dc',
						value: dcInput,
						unit: 'W',
						caption: msg.flow_dc_input(),
						valueClass: 'font-semibold text-energy-solar'
					},
			efficiency === undefined || efficiency <= 0
				? null
				: {
						id: 'eff',
						value: efficiency,
						unit: '%',
						caption: msg.flow_efficiency(),
						valueClass: 'font-semibold text-primary',
						icon: GaugeIcon
					},
			selfUse === undefined
				? null
				: {
						id: 'self',
						value: Math.abs(selfUse),
						unit: 'W',
						caption: msg.flow_self_use(),
						valueClass: 'font-medium'
					}
		].filter((figure) => figure !== null)
	);
</script>

{#if shown.length > 0}
	<div
		class="absolute bottom-full left-1/2 mb-2.5 flex -translate-x-1/2 justify-center gap-4 rounded-xl border border-border/60 bg-background/85 px-3 py-1.5 leading-tight backdrop-blur-[2px]"
	>
		{#each shown as figure (figure.id)}
			<HubMetric {...figure} />
		{/each}
	</div>
{/if}
