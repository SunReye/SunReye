<!-- fallow-ignore-file unused-file -- phase 2.2 of the layout system: the primitives ship before the routes migrate onto them; the migration commits remove this line -->
<script lang="ts">
	// The one section card: bordered stack, uppercase muted title, optional
	// caption, optional right-hand actions, optional collapse. The header row
	// and the collapsible content live in their own files; what is left here is
	// the card and the open-state contract.
	//
	// This is a promotion of `lib/components/settings/settings-section.svelte`,
	// which was already cross-feature (four automations components import it) —
	// its name and its home under `settings/` are precisely why the statistics,
	// system and controls authors each wrote their own instead, six variants in
	// total with three different gaps and one missing header gap entirely.
	import type { Snippet } from 'svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { sectionShellClass } from '$lib/layout/tokens';
	import { sectionOpen, writesOwnOpen } from '$lib/layout/section-state';
	import SectionHeader from './section-header.svelte';
	import SectionBody from './section-body.svelte';

	let {
		title,
		caption,
		actions,
		collapsible = false,
		open = $bindable(),
		controlled = false,
		onOpenChange,
		dashed = false,
		dimmed = false,
		children
	}: {
		title: string;
		/** Context under the title, e.g. "This month, by day". */
		caption?: string;
		/** Right-aligned header content: filter, button, status badge. */
		actions?: Snippet;
		/** Renders the collapse trigger and lets the content fold away. */
		collapsible?: boolean;
		/**
		 * Open state. Left unset it means "not yet decided" and the content
		 * shows — no default here, or a stored preference still in flight would
		 * blank the section out and pop it back in.
		 */
		open?: boolean;
		/**
		 * The caller computes `open` on every render (a `$derived`, which cannot
		 * be `bind:`-ed) and updates its own state from `onOpenChange`. The
		 * section then never writes `open`; see `writesOwnOpen`.
		 */
		controlled?: boolean;
		onOpenChange?: (open: boolean) => void;
		/** Customize mode: the section is being arranged, not just read. */
		dashed?: boolean;
		/** Hidden-section preview — still mounted, visibly demoted. */
		dimmed?: boolean;
		children: Snippet;
	} = $props();

	// A non-collapsible section is always open; see section-state.ts.
	const contentOpenState = $derived(sectionOpen({ collapsible, open }));

	function handleOpenChange(next: boolean) {
		if (writesOwnOpen(controlled)) open = next;
		onOpenChange?.(next);
	}
</script>

<Collapsible.Root open={contentOpenState} onOpenChange={handleOpenChange}>
	<section class={sectionShellClass({ dashed, dimmed })}>
		<SectionHeader {title} {caption} {actions} {collapsible} />
		<SectionBody {children} />
	</section>
</Collapsible.Root>
