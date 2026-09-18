<script lang="ts">
	/**
	 * The state-of-charge figure inside a gauged power-flow node.
	 *
	 * Its own component rather than markup in `power-flow-node.svelte` because
	 * that template is already the diagram's most branched one and this pushed it
	 * past the complexity ceiling the repo enforces (`bunx fallow audit`). The
	 * node asks "draw the number if there is one"; deciding whether there is one
	 * belongs here.
	 *
	 * It renders nothing at all for a node with no SoC, so the caller carries no
	 * `{#if}` of its own.
	 */
	let {
		/** Whole percent, or `undefined` for a node that reports no charge. */
		soc
	}: { soc: number | undefined } = $props();
</script>

{#if soc !== undefined}
	<span class="soc-readout text-lg font-semibold tabular-nums sm:text-xl 2xl:text-3xl">
		{soc}<!--
			`0.68em`, not `0.55em`: the readout is `text-lg` (18px) on a phone, where
			0.55 drew the unit at 9.9px — under the 12px floor the layout system sets
			for a phone, inside the one figure on the diagram that has to be readable
			across a room. 0.68 lands it at 12.2px there and scales with the number
			everywhere else.
		--><span class="text-[0.68em] font-medium">%</span>
	</span>
{/if}
