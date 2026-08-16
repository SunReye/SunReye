<script lang="ts">
	// Square state-of-charge gauge traced just inside a power-flow node box, plus the
	// percentage badge on its lower edge. Renders nothing without a reading, so the
	// caller can hand it an optional SoC directly.
	//
	// Geometry: viewBox 56×56 scaled with the box, so a gauged node keeps the same
	// footprint as every other node. The perimeter drives the dash fill the way a
	// circumference would on a round gauge.
	import { socColor } from '$lib/inverter/sign-colors';

	let { soc }: { soc: number | undefined } = $props();

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
			style="transition:stroke-dashoffset 500ms linear, stroke 500ms linear"
		/>
	</svg>
	<span
		class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border border-border bg-background px-1.5 text-[0.62rem] font-semibold tabular-nums leading-tight"
		style={`color:${socColor(soc)}`}
	>
		{Math.round(soc)}%
	</span>
{/if}
