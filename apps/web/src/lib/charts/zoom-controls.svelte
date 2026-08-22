<script lang="ts">
	// The way back out of a zoom, and nothing else.
	//
	// It used to be two chips: this reset, and a ⌕ that ARMED pinch. The arm
	// button is gone, because pinch is live on every chart at all times now
	// (`charts/touch-gestures.ts`, driven from `layout/plot-frame.svelte`) and
	// there is nothing left to switch on. That chip was never a feature anyone
	// wanted — it was the price of a library pointer path that could not tell two
	// fingers from one, and it cost a reader on a phone a tap and a hunt before
	// they could zoom at all.
	//
	// What survives is the part that actually matters, and it matters more now
	// that the gesture is one pinch away: a chart left narrowed with no visible
	// control is a chart that looks broken — the numbers are simply wrong and
	// nothing on screen says why. So the reset appears the moment anything is
	// zoomed, whether that zoom is this chart's own transform or a refetch its
	// owner did on the strength of a selection here.
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import type { ChartZoom } from './zoom.svelte';

	let {
		zoom,
		resettable = false
	}: {
		zoom: ChartZoom;
		/**
		 * The OWNER is holding a zoom — a refetched range or chart spec. The
		 * chart's own transform has already been reset in that case, so it cannot
		 * be read off `zoom.zoomed`.
		 */
		resettable?: boolean;
	} = $props();

	const showReset = $derived(resettable || zoom.zoomed);
</script>

<!-- Over the plot rather than beside it: the charts this sits on are as short as
     176px, and a control row of its own would cost a tenth of that on every one
     of them. `pointer-events-none` on the strip keeps the plot underneath
     hoverable — and, now that a pinch is a plot gesture rather than a chip, keeps
     the two fingers reaching the frame's own handlers everywhere the button is
     not. The top-right corner faces the full-screen control in the bottom-right;
     see `layout/plot-frame.svelte` for why they are diagonal. -->
{#if showReset}
	<div class="pointer-events-none absolute right-1 top-1 z-10 flex gap-0.5">
		<Button
			variant="ghost"
			size="icon-sm"
			class="pointer-events-auto bg-background/70 text-muted-foreground backdrop-blur-sm"
			title={m.chart_zoom_reset()}
			aria-label={m.chart_zoom_reset()}
			onclick={() => zoom.reset()}
		>
			<ArrowCounterClockwise />
		</Button>
	</div>
{/if}
