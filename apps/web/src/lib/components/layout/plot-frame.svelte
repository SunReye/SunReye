<script lang="ts">
	// The plot's own box — zone 4. Two jobs, and the second is why this is a
	// component rather than a `class="relative h-full w-full"` written out at
	// every chart: it is the positioning context the corner controls anchor to,
	// and it is the one place that decides WHICH corner each of them gets.
	//
	// Top right, transient: the zoom reset and the live window, drawn by
	// `charts/zoom-controls.svelte` and passed in as `chips` by the charts that
	// have a gesture. Bottom right, permanent: full screen.
	//
	// Diagonally opposite, on purpose. Full screen used to be one icon in the
	// header cluster beside the collapse caret, and the reported problem was
	// mispresses between the two. Opposite corners of the plot is the largest
	// separation available inside one card, and the pair also differ in kind: one
	// undoes a gesture, the other changes the whole screen.
	//
	// What it costs, stated plainly: on a mouse the resting gesture is the brush,
	// and this button sits on that surface, so a press STARTING inside its 44px
	// box is a button press and not the start of a selection. That cannot be
	// handed back — LayerChart begins a brush on ITS pointerdown, and an element
	// that received the event instead cannot retroactively give it up. It is the
	// least costly 44px on the plot: the right edge is the newest data, where a
	// reader is looking rather than selecting, and the bottom band is the axis.
	// On touch nothing is lost, because a one-finger drag belongs to the page
	// there. The reverse mistake IS guarded — see `fullscreen-trigger.svelte`.
	import type { Snippet } from 'svelte';
	import FullscreenTrigger from './fullscreen-trigger.svelte';
	import { useFullscreen } from '$lib/charts/fullscreen-context';

	let {
		children,
		chips
	}: {
		children: Snippet;
		/** The transient top-right corner: reset, live window. Charts with a
		 *  gesture pass `ZoomControls` here; the rest pass nothing. */
		chips?: Snippet;
	} = $props();

	// Null in a dialog or the correction panel, which have no card and bring
	// their own frame — see `fullscreen-context.ts`. No box, no corner control.
	const source = useFullscreen();

	// One corner control per CARD, not per plot: a card can hold two plots (the
	// energy split holds consumption and production) and both would otherwise
	// draw a ⤢ that expands the card rather than either plot. First frame to ask
	// gets it; see `claimCorner`.
	const token = Symbol('plot-frame');
	const ownsCorner = source?.claimCorner(token);
	$effect(() => () => source?.releaseCorner(token));

	// Resolved here rather than in the template, which is the one thing in this
	// repo that cannot be unit-tested and so carries no logic it does not have to.
	const showsCorner = $derived(!!source && ownsCorner?.() === true);

	// Two notes about the markup below, kept here because the template's own size
	// is measured:
	//
	//  - `relative` on the outer div is what both corners resolve against, and
	//    `h-full w-full` is what the charts inside expect: the height is the
	//    card's (`CHART_BOX`), never this frame's to decide.
	//  - The corner control's POSITION goes on a wrapper, never on the trigger.
	//    `FullscreenTrigger` carries `TAP` — `relative after:absolute
	//    after:-inset-3.5` — because it needs `relative` for the ::after that
	//    grows its 16px icon to a 44px hit area. Handing it `absolute` in the same
	//    attribute puts two position utilities on one element and the winner is
	//    whichever Tailwind EMITS later, not whichever was written later:
	//    `.relative` follows `.absolute` in the generated sheet, so the button
	//    stayed in flow and rendered against the plot's LEFT edge, 320px from the
	//    corner it was meant to be in. Plausible in the source, wrong on screen —
	//    `e2e/plot-corner-controls.spec.ts` measures it. The zoom chips across the
	//    plot use a positioned wrapper for the same reason.
	//  - Semi-opaque like those chips: solid would punch a hole in whichever
	//    series runs through the corner.
</script>

<div class="relative h-full w-full">
	{@render children()}
	{@render chips?.()}
	{#if showsCorner}
		<div class="absolute bottom-1 right-1 z-10">
			<FullscreenTrigger screen={source!.box} class="bg-background/70 backdrop-blur-sm" />
		</div>
	{/if}
</div>
