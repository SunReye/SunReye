<script lang="ts">
	// The collapse caret, on its own rather than inside the actions cluster.
	//
	// It used to live in `section-actions.svelte` beside the caller's controls.
	// Grouped with the chrome it reads as a "show more" button rather than as the
	// section's own affordance — and while the header was one wrapping flex row it
	// also inherited the cluster's phone behaviour: a full centred row of its own,
	// a row spent on every collapsible section.
	//
	// Splitting on "does this section pass an `actions` snippet" does NOT work and
	// was tried: the statistics sections all pass one — `SectionControls`, which
	// renders nothing outside customize mode — so the prop is truthy while the
	// cluster is visually empty. Being a separate element from the cluster is what
	// actually holds it.
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as m from '$lib/paraglide/messages';
	import { TAP } from '$lib/layout/tokens';

	let { title }: { title: string } = $props();
</script>

<!-- No `order` any more: the pair this carried existed only because the header
     was a wrapping row that put the caret and the cluster on different lines at
     phone width. The header is a grid now, both live in column two at every
     width, and `section-header.svelte` writes them in reading order. -->
<Collapsible.Trigger
	class="group {TAP} text-muted-foreground transition-colors hover:text-foreground"
	aria-label={m.layout_section_toggle_aria({ section: title })}
>
	<CaretDown class="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
</Collapsible.Trigger>
