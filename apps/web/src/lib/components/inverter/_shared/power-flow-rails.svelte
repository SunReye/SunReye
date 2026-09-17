<script lang="ts">
	// The connector rails between the power-flow nodes: a solid cable per segment,
	// with charges of energy flying along the moving ones.
	//
	// A charge is a CHAIN OF BEADS, not a dash and not one sprite. A dash pattern
	// can only taper by opacity; a single sprite can only be placed and rotated,
	// so on this diagram's Béziers it cuts the corner and reads as a straight
	// splinter laid across a curved wire. Every bead gets its own
	// `<animateMotion>` down the same cable, lagging the one ahead of it, so the
	// comet bends with the rail because every part of it is separately on the
	// path. The chain's blur fuses them into one streak with a white-hot head.
	//
	// The motion path is the rail's own cable, referenced by `<mpath>`, so a
	// resize moves the charge with the wire rather than stranding it.
	//
	// One charge per rail, and its SPEED is the magnitude: a trickle drifts, a
	// rail at the plant's peak snaps across. Speed is a timing property, and
	// changing a running animation's duration remaps its elapsed time — so the
	// crossing time is quantized to quarter-seconds in flow-pulse.ts, and an
	// unchanged-enough reading emits a byte-identical `dur` that never touches
	// the animation at all. Size and bloom follow the same reading.
	//
	// Paths arrive in real pixels (the caller measures the safe box), so this only
	// draws — see power-graph.ts for the routing. `flowing` is pre-filtered to the
	// non-idle segments so the two passes stay a plain pair of loops.
	import { fade } from 'svelte/transition';
	import { motion } from '$lib/motion/tier.svelte';
	import type { Flow } from '$lib/inverter/power-graph';
	import type { RailPulse } from '$lib/inverter/flow-pulse';
	import PowerFlowCharge from './power-flow-charge.svelte';

	let {
		lines,
		flowing,
		width,
		height
	}: {
		lines: RailLine[];
		flowing: RailLine[];
		width: number;
		height: number;
	} = $props();

	// A rail that reverses is a different group (the key carries the flow), so the
	// old charges fade out while the new ones fade in at their own phase instead
	// of teleporting to the mirrored point. SMIL is not reachable from CSS, so
	// both degraded pictures are answered in the MARKUP rather than in a media
	// query — see `$lib/motion/tier` for what the tiers mean and why a wall
	// tablet ends up on one:
	//
	//   full  — the comet chains, blur bloom and all.
	//   lite  — one dashed cable per rail, travelling. Same direction, same
	//           speed, same magnitude (stroke width), at the cost of a thin
	//           stroke repaint instead of a bead chain under a filter. Measured
	//           on the idle overview at 6× CPU throttle, the comet chains'
	//           SVG subtree cost ~6.5 ms of every frame's style/paint/composite.
	//   still — nothing moves: a plain overlay that still states the magnitude.
	const fadeMs = $derived(motion.still ? 0 : 300);

	// Both degraded tiers draw ONE overlay path per lit rail, and differ only in
	// what is on it: `lite` gets the travelling dash (direction is the datum, so
	// the reverse class carries it), `still` gets nothing that moves. Resolved
	// here rather than as a second template branch — the markup is at the repo's
	// complexity ceiling, and an overlay that two branches had to keep in step
	// is exactly the kind of drift the ceiling exists to prevent.
	const overlayClass = (flow: Flow): string => {
		if (motion.still) return '';
		return flow === 'out' ? 'lite-flow lite-flow-out' : 'lite-flow';
	};
	/** The dash's period, and nothing at all when nothing moves. */
	const overlayStyle = (pulse: RailPulse): string =>
		motion.still ? '' : `--flow-dur:${pulse.dur}s`;
	/** A lit rail states its magnitude even when it is standing still. */
	const overlayOpacity = (pulse: RailPulse): number => 0.4 + pulse.share * 0.48;

	// Cable ids the movers' <mpath> points at. Scoped to this instance so two
	// diagrams on one page (a dashboard and a dialog) cannot capture each other's.
	const uid = $props.id();
	const cableId = (id: string): string => `${uid}-cable-${id}`;
</script>

<script module lang="ts">
	export type RailLine = {
		id: string;
		flow: Flow;
		/** Tailwind text-colour class driving `currentColor`. */
		color: string;
		/** Charge count, size and bloom for this rail's magnitude. */
		pulse: RailPulse;
		d: string;
	};
</script>

<!-- `overflow-visible` because an <svg> clips to its viewport, and this one is
     inset from the hero by a caption stack on every side (power-graph.ts). A
     charge's bloom is far wider than the charge, so a rail running near the edge
     had its halo cut off by a hard straight line. -->
<svg
	class="absolute inset-0 overflow-visible"
	{width}
	{height}
	viewBox={`0 0 ${width} ${height}`}
	aria-hidden="true"
>
	<!-- The cables first (all segments) so a later segment's idle rail never
	     overpaints an earlier segment's lit one where routes cross. They carry
	     the ids the charges fly along. -->
	{#each lines as l (l.id)}
		<path
			id={cableId(l.id)}
			class="text-border"
			d={l.d}
			fill="none"
			stroke="currentColor"
			stroke-width="3"
			stroke-linecap="round"
		/>
	{/each}
	{#each flowing as l (`${l.id}-${l.flow}`)}
		<g class={l.color} transition:fade={{ duration: fadeMs }}>
			{#if motion.tier === 'full'}
				<PowerFlowCharge pulse={l.pulse} flow={l.flow} cable={cableId(l.id)} />
			{:else}
				<!-- One overlay on the cable's own `d`, so it bends with the wire like
				     the beads do. At `lite` its dash travels; at `still` it is a plain
				     coloured rail rather than a frozen row of sprites, which would read
				     as debris left on the wire. -->
				<path
					class={overlayClass(l.flow)}
					d={l.d}
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-width={l.pulse.width}
					stroke-opacity={overlayOpacity(l.pulse)}
					style={overlayStyle(l.pulse)}
				/>
			{/if}
		</g>
	{/each}
</svg>

<style>
	/* One thin stroke per rail, repainted along its own path — no filter, no
	   per-bead SMIL attribute writes, so the frame costs a dash pattern rather
	   than a bead chain under a blur. The dash CYCLE is 24 user units, which is
	   what the keyframe translates by: any other offset makes the pattern jump
	   at the loop point instead of repeating seamlessly. */
	.lite-flow {
		stroke-dasharray: 10 14;
		/* STEPPED, not linear. A continuous dash repaints the stroke on every one
		   of the ~60 frames a second the browser offers; in 12 steps it repaints
		   12 times a crossing and still reads as travel — a chase light rather
		   than a glide. That is the difference between this tier costing a
		   fraction of the comet chains and costing most of them. */
		animation: flow-dash var(--flow-dur, 2s) steps(12, end) infinite;
	}
	/* Direction is the datum, so it is answered here rather than by negating the
	   duration (a negative `dur` is not a thing an animation accepts). */
	.lite-flow-out {
		animation-direction: reverse;
	}
	@keyframes flow-dash {
		to {
			stroke-dashoffset: -24;
		}
	}
	/* The tier already answers this — `motion.still` renders no `.lite-flow` at
	   all — but a viewer who flips the OS switch mid-frame gets the still picture
	   on the very next paint rather than on the next sample. */
	@media (prefers-reduced-motion: reduce) {
		.lite-flow,
		.lite-flow-out {
			animation: none;
		}
	}
</style>
