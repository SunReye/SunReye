<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { STATE_LABEL, STATE_VARIANT } from './run-state';
	import { REGIME_LABEL, REGIME_VARIANT } from './price-regime';
	import type { PeakShavingRunState } from '$lib/automations';
	import type { PriceRegime } from '@SunReye/contracts/automation';

	// Run state and price regime side by side. Two badges rather than one merged
	// label because they answer different questions — "is it steering?" and "what
	// is it doing about prices?" — and a combined enum would be their cross product.
	let { runState, regime }: { runState: PeakShavingRunState; regime: PriceRegime } = $props();
</script>

<div class="flex items-center gap-2">
	{#if regime !== 'none'}
		<Badge variant={REGIME_VARIANT[regime]}>{REGIME_LABEL[regime]()}</Badge>
	{/if}
	<Badge variant={STATE_VARIANT[runState]}>{STATE_LABEL[runState]()}</Badge>
</div>
