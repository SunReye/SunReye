<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import FieldInfo from './field-info.svelte';
	import * as Alert from '$lib/components/ui/alert';
	import * as m from '$lib/paraglide/messages';

	/**
	 * The Solarspitzengesetz corner of the forecast config: the export cap as a
	 * share of installed kWp, and the smart-meter-gateway install date that lifted
	 * it.
	 *
	 * The percentage is **not stored**. `maxOutputW` is already the single truth
	 * for the plant's export ceiling, and keeping a second copy of the same
	 * physical quantity would only create a reconciliation rule. So the chips just
	 * compute a value and write it into the field the user can still edit by hand.
	 */
	let {
		maxOutput = $bindable(),
		smartMeterSince = $bindable(),
		totalKwp,
		disabled
	}: {
		/** Max grid feed-in, kW, as edit text (shared with the field above). */
		maxOutput: string;
		/** Gateway install date, `YYYY-MM-DD`, or '' when not installed. */
		smartMeterSince: string;
		/** Installed DC capacity across all arrays, kWp. */
		totalKwp: number;
		disabled: boolean;
	} = $props();

	const PERCENTS = [60, 70, 100];

	const applyPercent = (pct: number): void => {
		maxOutput = ((totalKwp * pct) / 100).toFixed(2).replace(/\.?0+$/, '');
	};
</script>

<div class="flex flex-col gap-3">
	{#if totalKwp > 0}
		<div class="flex flex-wrap items-center gap-2">
			<span class="text-xs text-muted-foreground">{m.weather_export_cap_helper()}</span>
			{#each PERCENTS as pct (pct)}
				<Button variant="outline" size="sm" {disabled} onclick={() => applyPercent(pct)}>
					{pct} %
				</Button>
			{/each}
		</div>
	{/if}

	<div class="flex flex-col gap-1.5">
		<div class="flex items-center gap-1.5">
			<Label for="smart-meter-since">{m.weather_smart_meter_since()}</Label>
			<FieldInfo
				label={m.weather_smart_meter_since()}
				info={m.weather_smart_meter_since_desc()}
			/>
		</div>
		<Input
			id="smart-meter-since"
			type="date"
			bind:value={smartMeterSince}
			{disabled}
			class="max-w-48"
		/>
	</div>

	{#if smartMeterSince}
		<Alert.Root>
			<Alert.Description>{m.weather_export_cap_lifted()}</Alert.Description>
		</Alert.Root>
	{/if}
</div>
