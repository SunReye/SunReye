<script lang="ts">
	import { Area, LinearGradient } from 'layerchart';
	import { houseLine } from '$lib/charts/house-style';

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
		<!-- `flow`: the house treatment for a SIGNED instantaneous measure. The
		     curve, the weight and the fill opacity are the table's
		     ($lib/charts/house-style); only the sign-split gradient is this
		     component's own, because it is what makes the kind. -->
		<Area y0={() => 0} {...houseLine('flow', { stroke: gradient })} fill={gradient} />
	{/snippet}
</LinearGradient>
