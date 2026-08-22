<script lang="ts">
	// A panel's readout row: its headline figure, and the control that moves the
	// window the figure states.
	//
	// Its own component because deciding WHICH cells the row spends is a handful
	// of guards, and inline in `chart-panel.svelte` they sat in the same template
	// as the card, the caption and the plot — over the complexity gate, and
	// unreadable well before that. It is also the pair `panel-summary.svelte` and
	// the deleted `panel-actions.svelte` used to be, back together in the one
	// place that now needs them: the row.
	//
	// The row costs a gap above the plot, so a panel with neither cell must not
	// draw one — the price curves carry a fixed caption, no scope and no figure.
	import PanelReadoutRow from '$lib/components/layout/panel-readout-row.svelte';
	import PanelSummary, { type PanelSummary as Summary } from './panel-summary.svelte';
	import ScopeToggle from './scope-toggle.svelte';
	import { summaryForScope } from '$lib/statistics/chart-scope';
	import type { SectionScope } from '$lib/statistics/chart-scope.svelte';
	import type { CostRange } from '$lib/cost/ranges';

	let {
		view,
		summary,
		switcher
	}: {
		view?: SectionScope;
		summary?: Summary;
		/** The picked range, passed by the one panel per section that carries the
		 *  window control; the section's other panels follow it. */
		switcher?: CostRange;
	} = $props();

	// Guarded by SCOPE, not merely by presence: a summary states the PICKED
	// window, so a chart zoomed out to context drops it rather than restating a
	// number its bars disagree with.
	const figure = $derived(summaryForScope(view?.scope, summary));
	// One object rather than two guards, so the template asks once and the two
	// non-optional props ScopeToggle takes are narrowed together.
	const scope = $derived(view && switcher ? { view, range: switcher } : undefined);
</script>

<PanelReadoutRow value={figure ? headline : undefined} controls={scope ? windowControl : undefined} />

{#snippet headline()}
	<PanelSummary shown={figure} />
{/snippet}

{#snippet windowControl()}
	{#if scope}
		<ScopeToggle view={scope.view} range={scope.range} />
	{/if}
{/snippet}
