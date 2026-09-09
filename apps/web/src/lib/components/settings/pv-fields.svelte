<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import type { ArrayText } from '$lib/settings/inverter-fields';
	import FieldInfo from './field-info.svelte';
	import PvArrayRow from './pv-array-row.svelte';
	import * as m from '$lib/paraglide/messages';

	// The strings an INVERTER converts and the panel physics they obey. Raw text
	// throughout — the parent parses on save (`$lib/settings/inverter-fields`).
	// `ArrayText` itself, not a structural copy: it carries an `overrides` bag this
	// form has no input for, and a copy of the three editable fields would erase
	// the overrides on every save while type-checking perfectly.
	let {
		arrays = $bindable(),
		tempCoeff = $bindable(),
		loss = $bindable(),
		disabled
	}: {
		arrays: ArrayText[];
		tempCoeff: string;
		loss: string;
		disabled: boolean;
	} = $props();

	function addArray() {
		arrays = [...arrays, { kwp: '', tilt: '30', azimuth: '0' }];
	}

	function removeArray(index: number) {
		arrays = arrays.filter((_, i) => i !== index);
	}

	const addDisabled = $derived(disabled || arrays.length >= 8);
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-center gap-1.5">
		<span class="text-sm font-medium">{m.weather_forecast_arrays()}</span>
		<FieldInfo label={m.weather_forecast_arrays()} info={m.weather_forecast_azimuth_hint()} />
	</div>
	{#if arrays.length === 0}
		<p class="text-sm text-muted-foreground">{m.weather_forecast_arrays_empty()}</p>
	{/if}
	{#each arrays as arr, i (i)}
		<PvArrayRow
			bind:kwp={arr.kwp}
			bind:tilt={arr.tilt}
			bind:azimuth={arr.azimuth}
			index={i}
			labelled={i === 0}
			{disabled}
			onremove={() => removeArray(i)}
		/>
	{/each}
	<div>
		<Button type="button" variant="outline" size="sm" onclick={addArray} disabled={addDisabled}>
			<PlusIcon class="size-4" />
			{m.weather_forecast_add_array()}
		</Button>
	</div>
</div>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
	<div class="flex flex-col gap-1.5">
		<Label for="forecast-temp-coeff">{m.weather_forecast_temp_coeff()}</Label>
		<Input id="forecast-temp-coeff" bind:value={tempCoeff} {disabled} inputmode="decimal" placeholder="-0.4" />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="forecast-loss">{m.weather_forecast_loss()}</Label>
		<Input id="forecast-loss" bind:value={loss} {disabled} inputmode="decimal" placeholder="14" />
	</div>
</div>
