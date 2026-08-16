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
	import type { FullscreenBox } from '$lib/charts/fullscreen.svelte';
	import { CLUSTER_GAP } from '$lib/layout/tokens';

	let {
		title,
		caption,
		actions,
		collapsible = false,
		screen = null
	}: {
		title: string;
		/** Context under the title, e.g. "This month, by day". */
		caption?: string;
		/** Right-aligned header content: filter, button, status badge. */
		actions?: Snippet;
		/** Renders the collapse trigger. */
		collapsible?: boolean;
		/** Present when the card can take the screen; renders the trigger. */
		screen?: FullscreenBox | null;
	} = $props();
</script>

<div class="flex flex-wrap items-center justify-between {CLUSTER_GAP}">
	<div class="flex min-w-0 flex-col">
		<!-- `truncate` is the desktop guard only, and `max-sm:whitespace-normal`
		     takes it back on a phone. Below ~345px of viewport the row has 264px
		     for a title after the shell and section gutters, and the longest German
		     one — "PV-Spitzenkappung & Prognoseladen", 33 monospace characters at
		     8.75px each — needs 289px: it lost its last four characters to an
		     ellipsis where the pre-migration header simply wrapped. Nothing is
		     bought by that, because the row is `flex-wrap`: an over-long title
		     pushes the action cluster onto its own line rather than off-screen, so
		     the only thing truncation protects at phone widths is a row height. A
		     title that silently loses its end is worse than one that takes two
		     lines. -->
		<h2 class="truncate max-sm:whitespace-normal text-sm font-medium uppercase tracking-wide text-muted-foreground">
			{title}
		</h2>
		{#if caption}
			<p class="text-xs text-muted-foreground/70">{caption}</p>
		{/if}
	</div>
	<SectionActions {title} {actions} {collapsible} {screen} />
</div>
