<script lang="ts">
	// The connector rails between the power-flow nodes: a static dotted rail per
	// segment, with a comet stream layered on top of the moving ones.
	//
	// Every comet on every rail travels at the same speed. What a reading changes
	// is how MANY comets are on the cable (four interleaved layers fading in and
	// out), how long their heads are, how fat they are and how far they bloom —
	// never a timing property, because changing one mid-flight remaps the elapsed
	// time and makes the whole stream jump at every sample. See flow-pulse.ts.
	//
	// Paths arrive in real pixels (the caller measures the safe box), so this only
	// draws — see power-graph.ts for the routing. `flowing` is pre-filtered to the
	// non-idle segments so the two passes stay a plain pair of loops.
	import { fade } from 'svelte/transition';
	import { MediaQuery } from 'svelte/reactivity';
	import type { Flow } from '$lib/inverter/power-graph';
	import { layerStyle, type RailPulse } from '$lib/inverter/flow-pulse';

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
	// old comets fade out while the new ones fade in at their own phase instead of
	// teleporting to the mirrored one. A Svelte transition is the one thing here
	// that CSS cannot gate, so the media query is read in script for this alone.
	const reduceMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	const fadeMs = $derived(reduceMotion.current ? 0 : 300);
</script>

<script module lang="ts">
	export type RailLine = {
		id: string;
		flow: Flow;
		/** Tailwind text-colour class driving `currentColor`. */
		color: string;
		/** Comet density, length, width and bloom for this rail's magnitude. */
		pulse: RailPulse;
		d: string;
	};
</script>

<svg class="absolute inset-0" {width} {height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
	<!-- Static dotted rails first (all segments) so a later segment's idle rail
	     never overpaints an earlier segment's coloured flow where routes cross. -->
	{#each lines as l (l.id)}
		<path
			class="text-border"
			d={l.d}
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-dasharray="0.1 8"
		/>
	{/each}
	<!-- Comet streams on top: four co-running layers per flowing rail, lit by the
	     rail's share of the remembered plant. -->
	{#each flowing as l (`${l.id}-${l.flow}`)}
		<g
			class={`pulse ${l.flow === 'in' ? 'pulse-in' : 'pulse-out'} ${l.color}`}
			style={`--pulse-dot:${l.pulse.dot}px;--pulse-w:${l.pulse.width}px;--pulse-glow:${l.pulse.glow}`}
			transition:fade={{ duration: fadeMs }}
		>
			{#each l.pulse.layers as opacity, i (i)}
				<path class="bloom" d={l.d} style={layerStyle(i)} stroke-opacity={opacity} />
				<path class="core" d={l.d} style={layerStyle(i)} stroke-opacity={opacity} />
			{/each}
		</g>
	{/each}
</svg>

<style>
	/* Registered so they can be transitioned at all: an unregistered custom
	   property is an untyped token stream and would jump between samples. */
	@property --pulse-dot {
		syntax: '<length>';
		inherits: true;
		initial-value: 5px;
	}
	@property --pulse-w {
		syntax: '<length>';
		inherits: true;
		initial-value: 3px;
	}
	@property --pulse-glow {
		syntax: '<number>';
		inherits: true;
		initial-value: 0.12;
	}

	/* Intensity glides between 1 Hz samples. None of these is a timing property:
	   a comet grows and brightens where it already is. */
	.pulse {
		transition:
			--pulse-dot 700ms linear,
			--pulse-w 700ms linear,
			--pulse-glow 700ms linear;
	}

	.pulse path {
		fill: none;
		stroke: currentColor; /* text-sign-* off sign-colors.ts, via the group */
		stroke-linecap: round;
		/* Dash STARTS are fixed by the layer's own period, so a changing
		   --pulse-dot lengthens a comet forward without moving any of them. */
		stroke-dasharray: var(--pulse-dot) calc(var(--lvl-period) - var(--pulse-dot));
		/* PULSE_PERIOD_S — a literal, never a datum. */
		animation-duration: 2.5s;
		animation-timing-function: linear;
		animation-iteration-count: infinite;
		/* Density is a layer fade, and the share is quantized, so the steps glide
		   rather than pop. */
		transition: stroke-opacity 700ms linear;
	}
	.core {
		stroke-width: var(--pulse-w);
	}
	/* The wide translucent stroke replaces the shadow filter this rail used to
	   paint through: plain paint, with no filter region to re-raster every frame
	   on a fanless wall panel. */
	.bloom {
		stroke-width: calc(var(--pulse-w) * 2.6);
		opacity: var(--pulse-glow);
	}

	.pulse-in path {
		animation-name: pulse-in;
	}
	.pulse-out path {
		animation-name: pulse-out;
	}
	/* Travel is exactly one base span, an integer multiple of every layer's
	   period, so the loop is seamless at every density. */
	@keyframes pulse-in {
		to {
			stroke-dashoffset: -200px;
		}
	}
	@keyframes pulse-out {
		to {
			stroke-dashoffset: 200px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pulse {
			transition: none;
		}
		.pulse-in path,
		.pulse-out path {
			animation: none;
			transition: none;
			/* Parked at the layer's own phase, so the beads stay interleaved and
			   still encode power through count, length, width and bloom. */
			stroke-dashoffset: calc(var(--lvl-phase) * -1);
		}
	}
</style>
