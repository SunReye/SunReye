<script lang="ts">
	import { Area, LinearGradient } from 'layerchart';
	import { curveCatmullRom } from 'd3-shape';

	// Diverging semantics: above 0 costs (importing, discharging), below 0 earns
	// (exporting, charging). The SIGN tokens and not the energy ones: this
	// component paints any metric carrying `flow`, which in the sample profile
	// includes battery power and battery current — pointing it at
	// `--energy-grid` would paint battery discharge as "grid dependence".
	//
	// Tokens and not the two oklch literals that were here: those were near
	// misses of --chart-8 and --chart-5, so they sat outside the palette
	// entirely. A reader who picked the colour-blind preset still got a red/green
	// fill on every flow metric card — the one place it matters most.
	const IMPORT_COLOR = 'var(--sign-bad)';
	const EXPORT_COLOR = 'var(--sign-good)';

	let {
		context
	}: {
		/** The AreaChart `marks` context; only the fields needed for the zero stop. */
		context: { yScale: (v: number) => number; height: number; padding: { bottom: number } };
	} = $props();

	const zero = $derived(context.yScale(0) / (context.height + context.padding.bottom));
</script>

<LinearGradient
	vertical
	stops={[
		[0, IMPORT_COLOR],
		[zero, IMPORT_COLOR],
		[zero, EXPORT_COLOR],
		[1, EXPORT_COLOR]
	]}
>
	{#snippet children({ gradient })}
		<Area
			y0={() => 0}
			curve={curveCatmullRom}
			line={{ stroke: gradient, 'stroke-width': 1.5 }}
			fill={gradient}
			fillOpacity={0.25}
		/>
	{/snippet}
</LinearGradient>
