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
	import { MediaQuery } from 'svelte/reactivity';
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
	// reduced motion is answered in the markup: no movers at all, and a plain
	// coloured overlay on the cable that still carries the magnitude.
	const reduceMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	const fadeMs = $derived(reduceMotion.current ? 0 : 300);

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
			{#if reduceMotion.current}
				<!-- Motion off: the rail states its magnitude as a still overlay
				     rather than a frozen row of sprites, which would read as debris
				     left on the wire. -->
				<path
					d={l.d}
					fill="none"
					stroke="currentColor"
					stroke-linecap="round"
					stroke-width={l.pulse.width}
					stroke-opacity={0.35 + l.pulse.share * 0.5}
				/>
			{:else}
				<PowerFlowCharge pulse={l.pulse} flow={l.flow} cable={cableId(l.id)} />
			{/if}
		</g>
	{/each}
</svg>
