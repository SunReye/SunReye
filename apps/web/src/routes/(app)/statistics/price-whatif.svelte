<script lang="ts">
	import type { SpotWhatIf } from 'server/src/statistics/spot-stats';
	import * as m from '$lib/paraglide/messages';
	import type { CostFormatters } from '$lib/cost/format';
	import { WHATIF_TILES } from '$lib/statistics/tiles';
	import StatTiles from './stat-tiles.svelte';

	// The window's imported energy repriced both ways. The caption is not
	// decoration: with no spot components configured the "spot cost" is bare
	// wholesale, and presenting that as a quote would mislead.
	let { whatIf, formatters }: { whatIf: SpotWhatIf; formatters: CostFormatters } = $props();
</script>

<div class="flex flex-col gap-3">
	<h3 class="text-sm font-medium">{m.statistics_prices_whatif()}</h3>
	<StatTiles defs={WHATIF_TILES} data={whatIf} {formatters} />
	<p class="text-xs text-muted-foreground">
		{whatIf.spotComponentsConfigured
			? m.statistics_prices_whatif_note({ coverage: formatters.pct(whatIf.coverage) })
			: m.statistics_prices_whatif_bare()}
	</p>
</div>
