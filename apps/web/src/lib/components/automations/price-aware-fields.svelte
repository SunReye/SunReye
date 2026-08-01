<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import * as Alert from '$lib/components/ui/alert';
	import NumericFieldGrid from './numeric-field-grid.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { AutomationConfig } from '$lib/automations';

	type PriceAware = AutomationConfig['peakShaving']['priceAware'];
	export type PriceNumKey =
		| 'negativeThresholdEurPerMwh'
		| 'minWindowMinutes'
		| 'lookaheadHours'
		| 'soakFloorW'
		| 'reserveMarginPct';

	// Numeric knobs ride as text (a half-typed value must not coerce to 0) and are
	// parsed by the parent on save; the booleans bind straight to the config.
	let {
		cfg = $bindable(),
		nums = $bindable(),
		readOnly,
		blocked
	}: {
		cfg: PriceAware;
		nums: Record<PriceNumKey, string>;
		readOnly: boolean;
		/** True when the plant has no smart-meter-gateway date — the switch is locked. */
		blocked: boolean;
	} = $props();

	const fields = $derived([
		{
			key: 'negativeThresholdEurPerMwh' as PriceNumKey,
			label: m.peak_shaving_pa_threshold(),
			desc: m.peak_shaving_pa_threshold_desc(),
			placeholder: '0'
		},
		{
			key: 'minWindowMinutes' as PriceNumKey,
			label: m.peak_shaving_pa_min_window(),
			desc: m.peak_shaving_pa_min_window_desc(),
			placeholder: '15'
		},
		{
			key: 'lookaheadHours' as PriceNumKey,
			label: m.peak_shaving_pa_lookahead(),
			desc: m.peak_shaving_pa_lookahead_desc(),
			placeholder: '8'
		},
		{
			key: 'soakFloorW' as PriceNumKey,
			label: m.peak_shaving_pa_soak_floor(),
			desc: m.peak_shaving_pa_soak_floor_desc(),
			placeholder: '0'
		},
		{
			key: 'reserveMarginPct' as PriceNumKey,
			label: m.peak_shaving_pa_margin(),
			desc: m.peak_shaving_pa_margin_desc(),
			placeholder: '5'
		}
	]);
</script>

<Separator />

<p class="text-sm font-medium">{m.peak_shaving_pa_title()}</p>
<p class="text-xs text-muted-foreground">{m.peak_shaving_pa_desc()}</p>

{#if blocked}
	<Alert.Root>
		<Alert.Description>{m.peak_shaving_pa_needs_smart_meter()}</Alert.Description>
	</Alert.Root>
{/if}

<div class="flex flex-col gap-1.5">
	<div class="flex items-center justify-between gap-4">
		<Label for="ps-pa-enabled">{m.peak_shaving_pa_enable()}</Label>
		<Switch
			id="ps-pa-enabled"
			bind:checked={cfg.enabled}
			disabled={readOnly || (blocked && !cfg.enabled)}
		/>
	</div>
	<p class="text-xs text-muted-foreground">{m.peak_shaving_pa_enable_desc()}</p>
</div>

<div class="flex flex-col gap-1.5">
	<div class="flex items-center justify-between gap-4">
		<Label for="ps-pa-shape">{m.peak_shaving_pa_shape()}</Label>
		<Switch id="ps-pa-shape" bind:checked={cfg.shapeSoc} disabled={readOnly} />
	</div>
	<p class="text-xs text-muted-foreground">{m.peak_shaving_pa_shape_desc()}</p>
</div>

<NumericFieldGrid idPrefix="ps-pa" {fields} bind:values={nums} {readOnly} />
