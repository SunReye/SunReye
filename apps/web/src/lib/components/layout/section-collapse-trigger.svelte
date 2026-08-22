<script lang="ts">
	// The collapse caret, on its own rather than inside the actions cluster.
	//
	// It used to live in `section-actions.svelte` beside the caller's controls,
	// which was fine while the cluster stayed on the title row. It does not any
	// more: on a phone a cluster with real controls takes a full centred row of
	// its own (see `sectionActionsClass`), and a caret dragged along with it reads
	// as a "show more" button and costs a row on every collapsible section.
	//
	// Splitting on "does this section pass an `actions` snippet" does NOT work and
	// was tried: the statistics sections all pass one — `SectionControls`, which
	// renders nothing outside customize mode — so the prop is truthy while the
	// cluster is visually empty. The caret being a separate row child is what
	// actually holds it.
	import CaretDown from 'phosphor-svelte/lib/CaretDown';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as m from '$lib/paraglide/messages';
	import { TAP } from '$lib/layout/tokens';

	let { title }: { title: string } = $props();
</script>

<!-- `order` keeps the DOM honest at both widths: the caret is written before the
     actions cluster so a phone puts it on the title row, and reordered after it
     from sm up so a laptop still reads title … controls caret, left to right. -->
<Collapsible.Trigger
	class="group order-2 sm:order-3 {TAP} text-muted-foreground transition-colors hover:text-foreground"
	aria-label={m.layout_section_toggle_aria({ section: title })}
>
	<CaretDown class="size-4 transition-transform group-data-[state=closed]:-rotate-90" />
</Collapsible.Trigger>
