<script lang="ts">
	// The header row's right-hand cluster: the caller's actions, the full-screen
	// toggle and the collapse caret. Its own file because the header template
	// crossed the complexity gate once the toggle joined the caret there — two
	// guarded branches in a row that have nothing to do with the title block.
	import type { Snippet } from 'svelte';
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as m from '$lib/paraglide/messages';
	import FullscreenTrigger from './fullscreen-trigger.svelte';
	import type { FullscreenBox } from '$lib/charts/fullscreen.svelte';
	import { CLUSTER_GAP, TAP } from '$lib/layout/tokens';

	let {
		title,
		actions,
		collapsible = false,
		screen = null
	}: {
		/** Only for the collapse trigger's label. */
		title: string;
		actions?: Snippet;
		collapsible?: boolean;
		screen?: FullscreenBox | null;
	} = $props();
</script>


<!-- Unguarded on purpose: a section with neither actions nor a trigger leaves
     this a zero-width flex child at the end of the row, which changes nothing
     visually — `justify-between` still puts the title block where one child
     alone would sit. Guarding it bought a branch and no pixels. -->
<div class="flex items-center {CLUSTER_GAP}">
	{@render actions?.()}
	{#if screen}
		<!-- Here rather than over the plot: the header already names the chart,
		     and a button floating in the plot's corner would sit on top of the
		     brush surface every one of these charts drag-selects with. -->
		<FullscreenTrigger {screen} />
	{/if}
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
