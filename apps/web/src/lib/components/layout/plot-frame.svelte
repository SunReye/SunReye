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
	import ZoomControls from '$lib/charts/zoom-controls.svelte';
	import { useFullscreen } from '$lib/charts/fullscreen-context';
	import {
		isPinching,
		touchIdle,
		touchStep,
		type TouchEvent,
		type TouchState
	} from '$lib/charts/touch-gestures';
	import type { ChartZoom } from '$lib/charts/zoom.svelte';

	let {
		children,
		zoom,
		resettable = false
	}: {
		children: Snippet;
		/**
		 * This plot's gesture controller, for the charts that have one. Passing it
		 * here rather than each chart rendering its own `<ZoomControls>` and its own
		 * handler: the transient corner and the pinch belong to the same box this
		 * frame already owns, and five charts had written the identical snippet.
		 */
		zoom?: ChartZoom;
		/** The OWNER is holding a zoom (a refetched range), so the way out must
		 *  show even though this chart's own transform is back at 1. */
		resettable?: boolean;
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

	// ── Two fingers zoom, always ────────────────────────────────────────────────
	// The arbitration is `charts/touch-gestures.ts` and the reason it lives out
	// here rather than in LayerChart is `charts/gesture.ts`'s `gestureProps`: the
	// library's pointer path cannot tell two fingers from one, so the chart keeps
	// `disablePointer` and this frame decides.
	//
	// A single pointer is never claimed. No `preventDefault`, no capture, nothing
	// — so a swipe scrolls the page and a hold scrubs the crosshair exactly as
	// before, which on a page ~100 charts deep is the property that matters most.
	let touch = $state<TouchState>(touchIdle());

	/** Two fingers are down, so the plot is being zoomed rather than read. */
	const pinching = $derived(isPinching(touch));

	/** One pointer event, in the module's vocabulary. Its own function because a
	 *  ternary inline put `drive` over the complexity gate. */
	function asEvent(kind: 'down' | 'move' | 'lift', event: PointerEvent): TouchEvent {
		const id = event.pointerId;
		if (kind === 'lift') return { kind, id };
		return { kind, id, at: { x: event.clientX, y: event.clientY } };
	}

	function drive(kind: 'down' | 'move' | 'lift', event: PointerEvent) {
		if (!zoom || event.pointerType !== 'touch') return;
		const { state, action } = touchStep(touch, asEvent(kind, event), 'x');
		touch = state;
		if (action.kind !== 'transform') return;
		// Ours now: stop the browser treating the same two fingers as a page
		// gesture of its own.
		event.preventDefault();
		zoom.pinch(action.factor, action.mid, action.pan);
	}

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

<!-- No ARIA role, and the warning is suppressed rather than answered: these
     handlers are a two-finger gesture surface over a graphic, not a control. The
     chart inside carries the semantics, every gesture here has a visible control
     that does the same thing (the corner ⤢, the reset chip), and a `role` on this
     div would announce a box that does nothing to a keyboard or a screen reader.

     `touch-none` is deliberately NOT here: the pointer handlers claim only
     multi-touch, and a blanket rule would take the page's scroll axis back on
     every chart — the exact regression the old arming chip existed to avoid. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="relative h-full w-full"
	onpointerdown={(event) => drive('down', event)}
	onpointermove={(event) => drive('move', event)}
	onpointerup={(event) => drive('lift', event)}
	onpointercancel={(event) => drive('lift', event)}
>
	<!-- `pointer-events-none` on the plot while two fingers are down: the tooltip
	     layer would otherwise keep scrubbing a crosshair under one of them, so a
	     pinch read as a reading and a zoom at the same time. -->
	<div class={['h-full w-full', pinching && 'pointer-events-none']}>
		{@render children()}
	</div>
	{#if zoom}
		<ZoomControls {zoom} {resettable} />
	{/if}
	{#if showsCorner}
		<div class="absolute bottom-1 right-1 z-10">
			<FullscreenTrigger screen={source!.box} class="bg-background/70 backdrop-blur-sm" />
		</div>
	{/if}
</div>
