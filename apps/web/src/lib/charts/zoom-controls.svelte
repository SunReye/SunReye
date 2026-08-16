<script lang="ts">
	// The affordance half of the zoom feature: what tells a viewer the gesture
	// exists, and — the part that actually matters — how they get back out.
	//
	// A chart left narrowed with no visible control is a chart that looks broken:
	// the numbers are simply wrong, and nothing on screen says why. So the reset
	// button appears the moment anything is zoomed, whether that zoom is this
	// chart's own transform or a refetch its owner did on the strength of a
	// selection here.
	import ArrowsIn from 'phosphor-svelte/lib/ArrowsIn';
	import ArrowCounterClockwise from 'phosphor-svelte/lib/ArrowCounterClockwise';
	import MagnifyingGlassPlus from 'phosphor-svelte/lib/MagnifyingGlassPlus';
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
	const pinchLabel = $derived(
		zoom.pinching ? m.chart_zoom_pinch_off() : m.chart_zoom_pinch_on()
	);
	const PinchIcon = $derived(zoom.pinching ? ArrowsIn : MagnifyingGlassPlus);

	// Semi-opaque rather than solid: these sit over the plot, and a solid chip
	// would punch a hole in whichever series runs under the top-right corner.
	const chip = 'pointer-events-auto bg-background/70 text-muted-foreground backdrop-blur-sm';
</script>

<!-- Over the plot rather than beside it: the charts this sits on are as short as
     176px, and a control row of its own would cost a tenth of that on every one
     of them. `pointer-events-none` on the strip keeps the plot underneath
     hoverable everywhere the two buttons are not. -->
<div class="pointer-events-none absolute right-1 top-1 z-10 flex gap-0.5">
	{#if showReset}
		<Button
			variant="ghost"
			size="icon-sm"
			class={chip}
			title={m.chart_zoom_reset()}
			aria-label={m.chart_zoom_reset()}
			onclick={() => zoom.reset()}
		>
			<ArrowCounterClockwise />
		</Button>
	{/if}
	<Button
		variant="ghost"
		size="icon-sm"
		class={chip}
		aria-pressed={zoom.pinching}
		title={pinchLabel}
		aria-label={pinchLabel}
		onclick={() => zoom.toggle()}
	>
		<PinchIcon />
	</Button>
</div>
