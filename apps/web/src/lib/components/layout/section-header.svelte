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
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as m from '$lib/paraglide/messages';
	import { CLUSTER_GAP, TAP } from '$lib/layout/tokens';

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
	<!-- Unguarded on purpose: a section with neither actions nor a trigger leaves
	     this a zero-width flex child at the end of the row, which changes nothing
	     visually — `justify-between` still puts the title block where one child
	     alone would sit. Guarding it bought a branch and no pixels. -->
	<div class="flex items-center {CLUSTER_GAP}">
		{@render actions?.()}
		{#if collapsible}
			<!-- The trigger is a bare 16px caret with no padding, and on a phone it
			     is the only way to fold a section, so TAP is the whole hit area:
			     44px square, measured by `tapTargetPx` in the suite. -->
			<Collapsible.Trigger
				class="group {TAP} text-muted-foreground transition-colors hover:text-foreground"
				aria-label={m.layout_section_toggle_aria({ section: title })}
			>
				<CaretDown class="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
			</Collapsible.Trigger>
		{/if}
	</div>
</div>
