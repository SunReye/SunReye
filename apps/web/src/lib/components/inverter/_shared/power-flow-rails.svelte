<script lang="ts">
	// The connector rails between the power-flow nodes: a static dotted rail per
	// segment, with travelling energy dots layered on top of the moving ones.
	//
	// Paths arrive in real pixels (the caller measures the safe box), so this only
	// draws — see power-graph.ts for the routing. `flowing` is pre-filtered to the
	// non-idle segments so the two passes stay a plain pair of loops.
	import type { Flow } from '$lib/inverter/power-graph';

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
</script>

<script module lang="ts">
	export type RailLine = {
		id: string;
		flow: Flow;
		/** Tailwind text-colour class driving `currentColor`. */
		color: string;
		/** Dash travel time in seconds. */
		dur: number;
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
	<!-- Travelling energy dots on top. -->
	{#each flowing as l (`flow-${l.id}`)}
		<path
			class={`flow-line ${l.flow === 'in' ? 'flow-in' : 'flow-out'} ${l.color}`}
			d={l.d}
			fill="none"
			stroke="currentColor"
			stroke-width="4"
			stroke-linecap="round"
			stroke-dasharray="0.1 13.9"
			style={`animation-duration:${l.dur}s`}
		/>
	{/each}
</svg>

<style>
	.flow-line {
		filter: drop-shadow(0 0 5px currentColor);
	}
	.flow-in {
		animation: flow-in linear infinite;
	}
	.flow-out {
		animation: flow-out linear infinite;
	}
	/* One dash period (0.1 + 13.9) per keyframe cycle for a seamless loop. */
	@keyframes flow-in {
		to {
			stroke-dashoffset: -14;
		}
	}
	@keyframes flow-out {
		to {
			stroke-dashoffset: 14;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flow-in,
		.flow-out {
			animation: none;
		}
	}
</style>
