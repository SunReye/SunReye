<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { CostFormatters } from '$lib/cost/format';

	// The payback bar: the one figure the amortisation section is about, drawn
	// once at full width above the tiles that break it down, with the rates the
	// lifetime counters were priced at underneath so the figure is auditable.
	let {
		progress,
		rates,
		formatters
	}: {
		/** 0..1 of the investment recovered. */
		progress: number;
		rates: { importPrice: number; exportPrice: number };
		formatters: CostFormatters;
	} = $props();

	const fillPercent = $derived(Math.round(progress * 100));
</script>

<div class="flex flex-col gap-1.5">
	<div
		role="progressbar"
		aria-label={m.amortisation_progress_aria()}
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={fillPercent}
		class="h-2 w-full overflow-hidden rounded-full bg-border/60"
	>
		<div
			class="h-full rounded-full bg-energy-solar"
			style={`width:${fillPercent}%;transition:width 700ms ease`}
		></div>
	</div>
	<span class="text-xs text-muted-foreground">
		{m.amortisation_rates_note({
			import: formatters.price(rates.importPrice),
			export: formatters.price(rates.exportPrice)
		})}
	</span>
</div>
