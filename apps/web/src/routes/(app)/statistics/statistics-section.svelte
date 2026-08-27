<script lang="ts">
	import type { Snippet } from 'svelte';
	import Section from '$lib/components/layout/section.svelte';
	import { getCustomizeSession } from '$lib/statistics/customize.svelte';
	import SectionControls from './section-controls.svelte';

	// The statistics page's binding of the shared section card: registry id,
	// customize-mode states and the viewer's collapse preference. Everything the
	// card itself used to hand-roll here — the frame, the uppercase header, the
	// caret, the reduced-motion slide — is `Section` now.
	let {
		id,
		title,
		caption,
		controls,
		children
	}: {
		/** Section id from the registry — the key the preferences hide it by. */
		id: string;
		title: string;
		/** Range context under the title, e.g. "This month, by day". */
		caption?: string;
		/** Ephemeral per-view controls, shown in the header for every viewer. */
		controls?: Snippet;
		children: Snippet;
	} = $props();

	const customize = getCustomizeSession();

	// null until the viewer touches the toggle: until then the preference
	// supplies the initial state, which may only arrive once the prefs fetch
	// lands. Customize mode forces the content open — the per-tile checkboxes
	// live inside it.
	let viewerOpen = $state<boolean | null>(null);
	const open = $derived(customize.active || (viewerOpen ?? !customize.sectionCollapsed(id)));
</script>

<!-- `controlled`: `open` above is recomputed from three inputs on every render,
     and a $derived cannot be `bind:`-ed. Section reports the toggle and writes
     nothing back; a write would hold only until the next recompute. -->
<Section
	{title}
	{caption}
	collapsible
	controlled
	open={open}
	onOpenChange={(v) => (viewerOpen = v)}
	dashed={customize.active}
	dimmed={customize.sectionHidden(id)}
>
	{#snippet actions()}
		<SectionControls {id} {title} {controls} />
	{/snippet}
	<!-- The content used to space itself at gap-6 inside a gap-3 card, so a
	     statistics section was looser inside than out and looser than every
	     other section on the site. Both are SECTION_GAP now; no escape hatch,
	     because a content-gap prop is how the six variants happened. -->
	{@render children()}
</Section>
