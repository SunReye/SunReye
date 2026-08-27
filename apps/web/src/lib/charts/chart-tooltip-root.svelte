<script lang="ts" generics="T = unknown">
	// The one tooltip root every chart in the app renders.
	//
	// LayerChart's own `Tooltip` positions itself against the pointer and, when
	// the box would leave the chart, FLIPS it to the other side — and then stops.
	// Measured on /statistics at 390px: a 241px-wide tooltip flipped left of a
	// pointer at viewport x 195 landed at `left: -53`, half of it off the screen,
	// which is the report. The same flip is what put it under the finger.
	//
	// Handing it NUMBERS for x/y turns that pass off completely (every branch of
	// its containment is guarded by `typeof x !== 'number'`) and makes the box
	// this component's business. The rule is `$lib/charts/tooltip-placement`,
	// which is pure and tested; the only thing measured here is the CHART's own
	// rect — an input, never this box, because a tooltip that measures itself,
	// moves, and measures again is the PR #60 loop.
	import { getChartContext, Tooltip as TooltipPrimitive } from 'layerchart';
	import type { Snippet } from 'svelte';
	import { pointerKind } from '$lib/charts/pointer.svelte';
	import { placeTooltip } from '$lib/charts/tooltip-placement';

	let {
		variant = 'default',
		children: body
	}: {
		/** LayerChart's own skin. `none` for the tooltips that bring their own. */
		variant?: 'default' | 'invert' | 'none';
		children?: Snippet<[{ data: T }]>;
	} = $props();

	const ctx = getChartContext();

	// Re-derived per pointer move and from nothing else: the pointer, the chart's
	// rect and the window. Same pointer, same answer — so a finger held still
	// cannot make the box drift.
	const placement = $derived.by(() => {
		const rect = ctx.containerRef?.getBoundingClientRect();
		return placeTooltip({
			pointerX: ctx.tooltip.x,
			pointerY: ctx.tooltip.y,
			containerLeft: rect?.left ?? 0,
			containerTop: rect?.top ?? 0,
			viewportWidth: typeof window === 'undefined' ? 0 : window.innerWidth,
			viewportHeight: typeof window === 'undefined' ? 0 : window.innerHeight,
			coarse: pointerKind.coarse
		});
	});
</script>

<!-- `contained={false}`: the numbers above already carry the containment, and
     LayerChart's version would only re-flip what was just clamped. The
     `max-width` is the other half of the arithmetic — the placement reserves
     that width, so the box must not exceed it.

     `motion="none"`: LayerChart springs `left`/`top` towards the position it is
     given (Tooltip.svelte, `motion = 'spring'` by default). Measured on
     /statistics with a finger held still on the plot, the box was at left 83.53
     and still walking to 84 six hundred milliseconds later while the chart's own
     box never moved — so for as long as the spring runs, the rendered box is
     NOT where the arithmetic put it. Two things depend on it being exactly
     there: the viewport clamp and the fingertip clearance, and a box in flight
     towards its clearance is a box passing under the hand it is meant to clear.
     A clamp is worth having only if it is the position, so the animation goes. -->
<TooltipPrimitive.Root
	{variant}
	contained={false}
	motion="none"
	x={placement.x}
	y={placement.y}
	anchor={placement.anchor}
	props={{ root: { style: `max-width: ${placement.maxWidth}px` } }}
>
	{#snippet children(args)}
		{@render body?.(args as { data: T })}
	{/snippet}
</TooltipPrimitive.Root>
