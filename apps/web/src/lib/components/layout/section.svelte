<script lang="ts">
	// The one section card: bordered stack, uppercase muted title, optional
	// caption, optional right-hand actions, optional collapse. The header row
	// and the collapsible content live in their own files; what is left here is
	// the card and the open-state contract.
	//
	// Promoted from `lib/components/settings/settings-section.svelte`, now
	// deleted. That one was already cross-feature (four automations components
	// imported it) — its name and its home under `settings/` are precisely why
	// the statistics, system and controls authors each wrote their own instead,
	// six variants with three different gaps and one missing header gap.
	import type { Snippet } from 'svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { sectionShellClass } from '$lib/layout/tokens';
	import { expandedSectionClass } from '$lib/layout/tokens';
	import { FullscreenBox } from '$lib/charts/fullscreen.svelte';
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
		nested = false,
		fullscreen = false,
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
		/** Card inside another card: no frame of its own below sm, where the
		 *  nested chrome costs a quarter of the screen. */
		nested?: boolean;
		/**
		 * The card holds a chart, so its header offers to take the whole screen.
		 * The card is the box that expands — header, body and the chart component
		 * itself, which keeps its brush and pinch bound the whole time.
		 */
		fullscreen?: boolean;
		children: Snippet;
	} = $props();

	// A non-collapsible section is always open; see section-state.ts.
	const contentOpenState = $derived(sectionOpen({ collapsible, open }));

	// Allocated unconditionally — it is three fields — but only *wired* when the
	// card asked for it, so a page of ordinary sections does not put three DOM
	// listeners each on the document.
	const screen = new FullscreenBox();
	let box = $state<HTMLElement | null>(null);
	$effect(() => {
		if (fullscreen) screen.box = box;
	});
	$effect(() => (fullscreen ? screen.listen() : undefined));

	function handleOpenChange(next: boolean) {
		if (writesOwnOpen(controlled)) open = next;
		onOpenChange?.(next);
	}
</script>

<Collapsible.Root open={contentOpenState} onOpenChange={handleOpenChange}>
	<section
		bind:this={box}
		class={expandedSectionClass(
			sectionShellClass({ dashed, dimmed, nested }),
			fullscreen && screen.expanded,
			fullscreen && screen.overlay
		)}
	>
		<SectionHeader {title} {caption} {actions} {collapsible} screen={fullscreen ? screen : null} />
		<SectionBody {children} />
	</section>
</Collapsible.Root>
