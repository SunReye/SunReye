<script lang="ts">
	// A chart panel: what it plots, over which window, and — when the panel owns
	// its section's scope — the control that moves it. The card itself is the
	// shared `Section`, so the panel no longer carries a heading, a border or a
	// gap of its own; its headline figure and its window control are the readout
	// row at the top of the body, above the plot they describe.
	//
	// `nested` because a panel always renders inside a statistics section, which
	// renders inside the page shell: three frames and three pads cost 50px per
	// side at 390px. The panel's frame comes back at sm.
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';
	import Section from '$lib/components/layout/section.svelte';
	import PanelReadout from './panel-readout.svelte';
	import { type PanelSummary as Summary } from './panel-summary.svelte';
	import type { SectionScope } from '$lib/statistics/chart-scope.svelte';
	import type { CostRange } from '$lib/cost/ranges';

	let {
		title,
		caption,
		view,
		summary,
		switcher,
		children
	}: {
		title: string;
		/** Fixed window caption, for panels that own no scope (the price curves
		 *  are always "today" and "tomorrow", whatever the page range is). */
		caption?: string;
		view?: SectionScope;
		summary?: Summary;
		/** The picked range, passed by the one panel per section that carries the
		 *  window control; the section's other panels follow it. */
		switcher?: CostRange;
		children: Snippet;
	} = $props();
</script>

<!-- The fade sits on a wrapper because the panel's root is now a component:
     panels come and go with their data (a window with no spend has no cost
     chart), and the transition has to be on an element this file owns. -->
<div transition:fade={{ duration: 200 }}>
	<!-- The window used to be glued onto the title with an em dash, which made a
	     long German heading truncate before its own name was readable. It is the
	     section caption now — its own line, under the title. -->
	<Section {title} caption={view?.caption ?? caption} nested fullscreen>
		<!-- The figure and the window control, one row, above the plot. They were
		     the header's action cluster and the first line of the body
		     respectively, and a header row reading "EUR 6.62 –  By day
		     12 months  ⤢" is five things wearing one grammar: a reader counts five
		     controls where there are two. Which of the two cells this panel spends
		     is `panel-readout.svelte`'s business, not the card's. -->
		<PanelReadout {view} {summary} {switcher} />
		{@render children()}
	</Section>
</div>
