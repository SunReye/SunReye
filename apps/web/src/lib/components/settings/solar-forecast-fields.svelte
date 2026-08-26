<script lang="ts" module>
	/** One PV array row as raw input text (parsed by the parent on save). */
	export type ArrayFields = { kwp: string; tilt: string; azimuth: string };
</script>

<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import FieldInfo from './field-info.svelte';
	import PvArrayRow from './pv-array-row.svelte';
	import ExportCapHelper from './export-cap-helper.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		arrays = $bindable(),
		tempCoeff = $bindable(),
		loss = $bindable(),
		maxOutput = $bindable(),
		houseLoad = $bindable(),
		battUsable = $bindable(),
		battCharge = $bindable(),
		battReserve = $bindable(),
		battNominalV = $bindable(),
		smartMeterSince = $bindable(),
		disabled
	}: {
		arrays: ArrayFields[];
		tempCoeff: string;
		loss: string;
		/** Max grid feed-in, kW (blank = no export limit). */
		maxOutput: string;
		/** Avg house load, kW (blank = infer median from history). */
		houseLoad: string;
		/** Usable battery energy, kWh (blank = no battery in the clipping model). */
		battUsable: string;
		/** Max battery charge power, kW (blank = unbounded). */
		battCharge: string;
		/** Battery reserve floor, % (blank = 10). */
		battReserve: string;
		/** Nominal pack voltage, V — blank keeps whatever the automation had. */
		battNominalV: string;
		/** Smart-meter-gateway install date, `YYYY-MM-DD`, or '' when none. */
		smartMeterSince: string;
		disabled: boolean;
	} = $props();

	const totalKwp = $derived(
		arrays.reduce((sum, a) => sum + (Number.parseFloat(a.kwp) || 0), 0),
	);

	function addArray() {
		arrays = [...arrays, { kwp: '', tilt: '30', azimuth: '0' }];
	}

	function removeArray(index: number) {
		arrays = arrays.filter((_, i) => i !== index);
	}

	const addDisabled = $derived(disabled || arrays.length >= 8);
	// The charge cap and reserve only apply once a usable capacity is given.
	const battDisabled = $derived(disabled || battUsable.trim() === '');
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
		<Button variant="outline" size="sm" onclick={addArray} disabled={addDisabled}>
			<PlusIcon class="size-4" />
			{m.weather_forecast_add_array()}
		</Button>
	</div>
</div>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
	<div class="flex flex-col gap-1.5">
		<Label for="forecast-temp-coeff">{m.weather_forecast_temp_coeff()}</Label>
		<Input
			id="forecast-temp-coeff"
			bind:value={tempCoeff}
			{disabled}
			inputmode="decimal"
			placeholder="-0.4"
		/>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="forecast-loss">{m.weather_forecast_loss()}</Label>
		<Input id="forecast-loss" bind:value={loss} {disabled} inputmode="decimal" placeholder="14" />
	</div>
</div>

<div class="flex flex-col gap-2">
	<div class="flex items-center gap-1.5">
		<span class="text-sm font-medium">{m.weather_forecast_clipping()}</span>
		<FieldInfo label={m.weather_forecast_clipping()} info={m.weather_forecast_clipping_desc()} />
	</div>
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-max-output">{m.weather_forecast_max_output()}</Label>
			<Input
				id="forecast-max-output"
				bind:value={maxOutput}
				{disabled}
				inputmode="decimal"
				placeholder="10"
			/>
			<ExportCapHelper bind:maxOutput bind:smartMeterSince {totalKwp} {disabled} />
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-house-load">{m.weather_forecast_house_load()}</Label>
			<Input
				id="forecast-house-load"
				bind:value={houseLoad}
				{disabled}
				inputmode="decimal"
				placeholder={m.weather_forecast_house_load_auto()}
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-batt-usable">{m.weather_forecast_battery_usable()}</Label>
			<Input
				id="forecast-batt-usable"
				bind:value={battUsable}
				{disabled}
				inputmode="decimal"
				placeholder="10"
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-batt-charge">{m.weather_forecast_battery_charge()}</Label>
			<Input
				id="forecast-batt-charge"
				bind:value={battCharge}
				disabled={battDisabled}
				inputmode="decimal"
				placeholder="5"
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-batt-reserve">{m.weather_forecast_battery_reserve()}</Label>
			<Input
				id="forecast-batt-reserve"
				bind:value={battReserve}
				disabled={battDisabled}
				inputmode="decimal"
				placeholder="10"
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<div class="flex items-center gap-1.5">
				<Label for="forecast-batt-nominal-v">{m.plant_battery_nominal_v()}</Label>
				<FieldInfo
					label={m.plant_battery_nominal_v()}
					info={m.plant_battery_nominal_v_desc()}
				/>
			</div>
			<Input
				id="forecast-batt-nominal-v"
				bind:value={battNominalV}
				disabled={battDisabled}
				inputmode="decimal"
				placeholder="51.2"
			/>
		</div>
	</div>
</div>
