<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import NumericFieldGrid from './numeric-field-grid.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { AutomationConfig } from '$lib/automations';

	type GridFriendly = AutomationConfig['peakShaving']['gridFriendly'];
	type NumKey = 'minThresholdW' | 'forecastTrustPct' | 'slewWPerMin' | 'chargeSlewAPerMin';

	// The numeric knobs ride as text (a half-typed value must not coerce to 0)
	// and are parsed by the parent on save; the boolean binds to the config.
	let {
		cfg = $bindable(),
		nums = $bindable(),
		readOnly
	}: { cfg: GridFriendly; nums: Record<NumKey, string>; readOnly: boolean } = $props();

	const fields = $derived([
		{
			key: 'minThresholdW' as NumKey,
			label: m.peak_shaving_gf_min_threshold(),
			desc: m.peak_shaving_gf_min_threshold_desc(),
			placeholder: '0'
		},
		{
			key: 'forecastTrustPct' as NumKey,
			label: m.peak_shaving_gf_trust(),
			desc: m.peak_shaving_gf_trust_desc(),
			placeholder: '100'
		},
		{
			key: 'slewWPerMin' as NumKey,
			label: m.peak_shaving_gf_slew(),
			desc: m.peak_shaving_gf_slew_desc(),
			placeholder: '600'
		},
		{
			key: 'chargeSlewAPerMin' as NumKey,
			label: m.peak_shaving_gf_charge_slew(),
			desc: m.peak_shaving_gf_charge_slew_desc(),
			placeholder: '10'
		}
	]);
</script>

<Separator />

<p class="text-sm font-medium">{m.peak_shaving_gf_title()}</p>

<NumericFieldGrid idPrefix="ps-gf" {fields} bind:values={nums} {readOnly} />

<div class="flex flex-col gap-1.5">
	<div class="flex items-center justify-between gap-4">
		<Label for="ps-gf-ev-reserve">{m.peak_shaving_gf_ev_reserve()}</Label>
		<Switch
			id="ps-gf-ev-reserve"
			bind:checked={cfg.reserveForEvDemand}
			disabled={readOnly}
		/>
	</div>
	<p class="text-xs text-muted-foreground">{m.peak_shaving_gf_ev_reserve_desc()}</p>
</div>
