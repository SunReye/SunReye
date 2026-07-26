<script lang="ts">
	// Spreads a `ResolvedAxes` onto ChartYAxes. Rendered inside a chart's `marks`,
	// where the plot `height` is first known. Shared by the two custom-chart surfaces
	// (custom-chart-card historical, custom-live-chart live) so the dual-axis wiring
	// lives in one place.
	import ChartYAxes from '$lib/components/inverter/chart-y-axes.svelte';
	import type { ResolvedAxes } from '$lib/components/inverter/_shared/chart-series';

	let { height, axes }: { height: number; axes: ResolvedAxes } = $props();
</script>

<ChartYAxes
	{height}
	left={axes.leftDomain}
	right={axes.rightDomain}
	leftUnit={axes.grouping.leftUnit}
	rightUnit={axes.grouping.rightUnit}
/>
