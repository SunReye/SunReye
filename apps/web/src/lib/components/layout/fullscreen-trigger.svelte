<script lang="ts">
	// The ⤢ / ⤡ toggle, shared by the section card's header and the standalone
	// chart frame — the icon, the label and the state read all flip together, so
	// writing them twice was three ternaries in each template and both over the
	// complexity gate.
	import ArrowsOut from 'phosphor-svelte/lib/ArrowsOut';
	import ArrowsIn from 'phosphor-svelte/lib/ArrowsIn';
	import * as m from '$lib/paraglide/messages';
	import type { FullscreenBox } from '$lib/charts/fullscreen.svelte';
	import { movedPastSlop, type Point } from '$lib/charts/pointer-slop';
	import { TAP } from '$lib/layout/tokens';

	let { screen, class: extra = '' }: { screen: FullscreenBox; class?: string } = $props();

	const label = $derived(screen.expanded ? m.chart_exit_fullscreen() : m.chart_fullscreen());

	// This button lives in a plot's bottom-right corner now (`plot-frame.svelte`),
	// on the surface a mouse drag brushes a window on. A `click` fires on the
	// nearest common ancestor of press and release, so a selection dragged
	// rightwards and released over this corner would expand the card — a gesture
	// about the data silently becoming a gesture about the screen. So a click
	// counts only if the pointer did not travel.
	//
	// Harmless in the header, where it was before and where nothing drags; kept
	// here rather than in a wrapper so both placements are one button with one
	// behaviour, and so the plot corner needs no second copy of this markup.
	let pressedAt = $state<Point | null>(null);

	function press(event: PointerEvent) {
		pressedAt = { x: event.clientX, y: event.clientY };
	}

	function activate(event: MouseEvent) {
		const from = pressedAt;
		pressedAt = null;
		// No pointerdown of ours means a keyboard activation — Enter and Space
		// fire `click` with no pointer, and those are always this button's.
		if (from && movedPastSlop(from, { x: event.clientX, y: event.clientY })) return;
		screen.toggle();
	}
</script>

<!-- A bare 16px icon like the collapse caret beside it, so TAP is the whole hit
     area: 44px square, measured by `tapTargetPx` in the suite. -->
<button
	type="button"
	class="{TAP} {extra} text-muted-foreground transition-colors hover:text-foreground"
	onpointerdown={press}
	onpointercancel={() => (pressedAt = null)}
	onclick={activate}
	title={label}
>
	{#if screen.expanded}
		<ArrowsIn class="size-4" />
	{:else}
		<ArrowsOut class="size-4" />
	{/if}
	<span class="sr-only">{label}</span>
</button>
