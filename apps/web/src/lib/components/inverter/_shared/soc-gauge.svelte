<script lang="ts">
	// Square state-of-charge gauge traced just inside a power-flow node box.
	// Renders nothing without a reading, so the caller can hand it an optional SoC
	// directly.
	//
	// The RING only: the percentage itself is the node box's content
	// (`power-flow-node.svelte`), not a badge on this gauge's lower edge. It was
	// one, at 0.62rem and tinted with the ramp below — under the repo's 12 px
	// phone floor, and `--sign-warn` on the light theme's white is 2.2:1. What
	// the ramp is good at is colouring a 2.5 px stroke; what it is bad at is
	// colouring 10 px digits.
	//
	// Geometry: viewBox 56×56 scaled with the box, so a gauged node keeps the same
	// footprint as every other node. The perimeter drives the dash fill the way a
	// circumference would on a round gauge.
	import { socColor } from '$lib/inverter/sign-colors';
	import { motion } from '$lib/motion/tier.svelte';

	let { soc }: { soc: number | undefined } = $props();

	// The fill glides toward each new reading at `full`, and steps to it below.
	// A transition on `stroke-dashoffset` repaints the whole traced rect on every
	// frame it runs, and there is one of these per gauged node.
	const ease = $derived(
		motion.tier === 'full' ? 'transition:stroke-dashoffset 500ms linear, stroke 500ms linear' : ''
	);

	const INSET = 2;
	const SIZE = 56 - INSET * 2;
	const PERIMETER = SIZE * 4;
</script>

{#if soc !== undefined}
	<svg class="absolute inset-0 size-full" viewBox="0 0 56 56" aria-hidden="true">
		<rect
			class="text-border"
			x={INSET}
			y={INSET}
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
		/>
		<rect
			x={INSET}
			y={INSET}
			width={SIZE}
			height={SIZE}
			fill="none"
			stroke={socColor(soc)}
			stroke-width="2.5"
			stroke-dasharray={PERIMETER}
			stroke-dashoffset={PERIMETER * (1 - soc / 100)}
			style={ease}
		/>
	</svg>
{/if}
