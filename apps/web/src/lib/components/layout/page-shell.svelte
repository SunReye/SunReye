<script lang="ts">
	// The one page container. Every route's outermost element is this, so the
	// content measure, gutter and vertical rhythm stop being a per-page choice —
	// seven pages had drifted to five rhythms and four measures, and /automations
	// and /automations/peak-shaving disagreed hard enough that the measure jumped
	// while navigating between them.
	//
	// It deliberately accepts NO `class` prop: an escape hatch here is exactly how
	// the drift happened. A page that genuinely needs a bespoke layout asks for
	// width="full" and owns its own inner markup.
	import type { Snippet } from 'svelte';
	import { CLUSTER_GAP, pageShellClass, type ShellWidth } from '$lib/layout/tokens';

	let {
		width = 'wide',
		lead,
		toolbar,
		children
	}: {
		/** Content measure, by intent: narrow (forms/lists), wide (dashboards), full. */
		width?: ShellWidth;
		/** Left-aligned start of the toolbar row: a back link or breadcrumb — where
		 *  the reader came from, not a control they operate. */
		lead?: Snippet;
		/** Page-level controls — range pickers, primary actions. Rendered first,
		 *  right-aligned, wrapping onto its own lines on a phone. */
		toolbar?: Snippet;
		children: Snippet;
	} = $props();

	// Lifted out of the template on purpose: `{#if lead || toolbar}` inline put
	// the shell's markup over the complexity gate (cyclomatic 5, CRAP 30) the
	// moment `lead` was added. The condition is the interesting part anyway —
	// the row exists only when something is going into one of its two ends.
	const hasToolbarRow = $derived(Boolean(lead ?? toolbar));
</script>

<div data-slot="page-shell" class={pageShellClass(width)}>
	<!-- One row, two ends. Before `lead` existed, a page with both had to put its
	     back link in `children`, which rendered it BELOW the toolbar: an extra
	     vertical row, and "where I came from" sitting under the live status it
	     has nothing to do with. Guarded together so a page with neither spends no
	     row at all, and `ml-auto` (not `justify-between`) keeps the controls hard
	     right whether or not a lead is present — with `justify-between` a
	     lead-less row would drift its single child to the left edge. -->
	{#if hasToolbarRow}
		<div class="flex flex-wrap items-center {CLUSTER_GAP}">
			{@render lead?.()}
			<!-- Own cluster so `justify-end` applies to the controls as a group:
			     spreading them across the row's free space is what a bare
			     `justify-between` on the outer row would do with two of them.

			     `w-full` below sm, and this is load-bearing rather than tidiness.
			     The cluster is a flex item, so without it the box is shrink-to-fit
			     and a child asking for `w-full` resolves against the cluster's own
			     CONTENT width — which is why the period navigator stretched across
			     /statistics (three controls made the cluster wide) and did not on
			     /history (it was the only child, so `w-full` meant "as wide as
			     itself"). Same markup, same component, two widths.

			     Phone-only, and it does relax the row's one-line rule there — see
			     the amended block in routes/(app)/page-shells.test.ts. At 390px the
			     line was never holding anyway: /statistics already spent two rows,
			     and a back link plus a period navigator do not share 390px. -->
			<div class="ml-auto flex max-sm:w-full flex-wrap items-center justify-end {CLUSTER_GAP}">
				{@render toolbar?.()}
			</div>
		</div>
	{/if}
	{@render children()}
</div>
