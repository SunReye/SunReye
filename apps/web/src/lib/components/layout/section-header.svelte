<script lang="ts">
	// The section card's header row: uppercase muted title, optional caption,
	// and one right-hand cluster holding the caller's actions and the collapse
	// trigger.
	//
	// Split out of `section.svelte` because the card had grown into a single
	// 100-line template that branched four ways — over the complexity gate, and
	// unreadable well before that. The split also makes the row reusable: the
	// page toolbar wants the same title/actions arrangement.
	import type { Snippet } from 'svelte';
	import SectionActions from './section-actions.svelte';
	import SectionCollapseTrigger from './section-collapse-trigger.svelte';
	import { sectionActionsClass, sectionHeaderGridClass } from '$lib/layout/tokens';

	let {
		title,
		caption,
		actions,
		collapsible = false
	}: {
		title: string;
		/** Context under the title, e.g. "This month, by day". */
		caption?: string;
		/** Right-aligned header content: filter, button, status badge. */
		actions?: Snippet;
		/** Renders the collapse trigger. */
		collapsible?: boolean;
	} = $props();
</script>

<div class={sectionHeaderGridClass()}>
	<div class="flex min-w-0 flex-col">
		<!-- `min-w-0` is what lets the `minmax(0,1fr)` track shrink all the way and
		     the `truncate` below actually fire; without it this block's min-content
		     width is the floor. -->
		<!-- `truncate` is the desktop guard only, and `max-sm:whitespace-normal`
		     takes it back on a phone. Below ~345px of viewport the row has 264px
		     for a title after the shell and section gutters, and the longest German
		     one — "PV-Spitzenkappung & Prognoseladen", 33 monospace characters at
		     8.75px each — needs 289px: it lost its last four characters to an
		     ellipsis where the pre-migration header simply wrapped. Nothing is
		     bought by that. The row no longer wraps, so an over-long title can no
		     longer displace anything: the chrome is in its own grid track and title
		     length is this column's business alone. A silent ellipsis is therefore
		     the ONLY thing truncation still buys at phone widths, and it buys it at
		     the price of the end of the title — which is the worse of the two. -->
		<h2 class="truncate max-sm:whitespace-normal text-sm font-medium uppercase tracking-wide text-muted-foreground">
			{title}
		</h2>
		{#if caption}
			<p class="text-xs text-muted-foreground/70">{caption}</p>
		{/if}
	</div>
	<!-- Grid column two is ONE cell, and this is it: a third child of the grid
	     would be auto-placed onto a second row. So the cell is drawn here and its
	     occupants — the caller's chrome and the caret — render into it without
	     boxes of their own. `data-slot` is on the cell for the same reason: it is
	     what `e2e/statistics-mobile-density.spec.ts` measures against the header
	     row, and a nested wrapper would make it measure against itself.

	     DOM order is now the reading order at every width (title … controls,
	     caret). The `order` pair the caret used to carry is gone with the
	     wrapping row that needed it: nothing about column two changes below
	     `sm`, so there is no phone-only arrangement left to correct. -->
	<div data-slot="section-actions" class={sectionActionsClass()}>
		<SectionActions {actions} />
		{#if collapsible}
			<SectionCollapseTrigger {title} />
		{/if}
	</div>
</div>
