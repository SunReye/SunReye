<script lang="ts">
	// The right-hand cluster of a chart panel's header: the control that moves
	// the window, for the one panel per section that carries it — and nothing
	// else.
	//
	// It used to carry the panel's headline figure too. A row reading
	// "EUR 6.62 –  By day  12 months  ⤢" is five things wearing one grammar, and
	// a reader counts five controls where there are two. The figure is the
	// panel's own data, so it renders in the body above the plot it describes
	// (`chart-panel.svelte`) and this cluster holds controls only.
	//
	// Still its own file: the panel's template branched four ways with the
	// cluster inline, which put it over the complexity gate.
	import ScopeToggle from './scope-toggle.svelte';
	import type { SectionScope } from '$lib/statistics/chart-scope.svelte';
	import type { CostRange } from '$lib/cost/ranges';

	let {
		view,
		switcher
	}: {
		view?: SectionScope;
		/** The picked range, passed by the one panel per section that carries the
		 *  window control; the section's other panels follow it. */
		switcher?: CostRange;
	} = $props();
</script>

{#if switcher && view}
	<ScopeToggle {view} range={switcher} />
{/if}
