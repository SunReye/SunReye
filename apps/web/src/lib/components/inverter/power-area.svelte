<script lang="ts">
	import { Area, LinearGradient } from 'layerchart';
	import { houseLine } from '$lib/charts/house-style';

	// `power`: ONE instantaneous measure sampled over time (W, A, %). The house
	// fill for it is the metric's own accent fading downward to transparent —
	// magnitude, without the claim a flat wash makes that the area under the line
	// is a total.
	//
	// Its own component, beside the `flow` mark it is chosen against in the same
	// `{#if diverging}`, because these six lines were written twice: the live
	// sparkline and the history card plot the same metric, and the previous pass
	// converged them by hand into two character-for-character identical copies.
	// Two copies of one decision is precisely the state that produced the drift
	// being undone — a flat 0.3 wash on the sparkline against a 0.9 gradient on
	// the card, which read as two different measures.
	//
	// The curve, the fill opacity and the outline's colour and dash are the
	// table's ($lib/charts/house-style); only the two-stop gradient is this
	// component's own, because it is what makes the kind.
	//
	// Not the WEIGHT, though `houseLine` states one: it comes back as the
	// hyphenated `'stroke-width'`, and layerchart's SVG `Path` assigns
	// `stroke-width={strokeWidthProp}` (camelCase) after spreading the rest — so
	// the house weight is overwritten with `undefined` and every SVG mark in the
	// app paints at the SVG default 1px. Measured in e2e/chart-power-fill.spec.ts.
	// Left alone here: it is one key in the table, it moves five plots at once,
	// and it is not this extraction's to decide.
	let { accent }: { accent: string } = $props();
</script>

<LinearGradient vertical stops={[[0, accent], [1, 'transparent']]}>
	{#snippet children({ gradient })}
		<Area {...houseLine('power', { stroke: accent })} fill={gradient} />
	{/snippet}
</LinearGradient>
