<script lang="ts" module>
	/** One PV array row as raw input text (parsed by the parent on save). */
	export type ArrayFields = { kwp: string; tilt: string; azimuth: string };
</script>

<script lang="ts">
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
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
		disabled: boolean;
	} = $props();

	function addArray() {
		arrays = [...arrays, { kwp: '', tilt: '30', azimuth: '0' }];
	}

	function removeArray(index: number) {
		arrays = arrays.filter((_, i) => i !== index);
	}
</script>

<div class="flex flex-col gap-2">
	<span class="text-sm font-medium">{m.weather_forecast_arrays()}</span>
	{#if arrays.length === 0}
		<p class="text-sm text-muted-foreground">{m.weather_forecast_arrays_empty()}</p>
	{/if}
	{#each arrays as arr, i (i)}
		<div class="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
			<div class="flex flex-col gap-1.5">
				{#if i === 0}<Label for={`array-kwp-${i}`}>{m.weather_forecast_kwp()}</Label>{/if}
				<Input
					id={`array-kwp-${i}`}
					bind:value={arr.kwp}
					{disabled}
					inputmode="decimal"
					placeholder="9.6"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				{#if i === 0}<Label for={`array-tilt-${i}`}>{m.weather_forecast_tilt()}</Label>{/if}
				<Input
					id={`array-tilt-${i}`}
					bind:value={arr.tilt}
					{disabled}
					inputmode="decimal"
					placeholder="30"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				{#if i === 0}<Label for={`array-azimuth-${i}`}>{m.weather_forecast_azimuth()}</Label>{/if}
				<Input
					id={`array-azimuth-${i}`}
					bind:value={arr.azimuth}
					{disabled}
					inputmode="decimal"
					placeholder="0"
				/>
			</div>
			<Button
				variant="ghost"
				size="icon"
				onclick={() => removeArray(i)}
				{disabled}
				aria-label={m.weather_forecast_remove()}
			>
				<TrashIcon class="size-4" />
			</Button>
		</div>
	{/each}
	<p class="text-xs text-muted-foreground">{m.weather_forecast_azimuth_hint()}</p>
	<div>
		<Button variant="outline" size="sm" onclick={addArray} disabled={disabled || arrays.length >= 8}>
			<PlusIcon class="size-4" />
			{m.weather_forecast_add_array()}
		</Button>
	</div>
</div>

<div class="grid gap-3 sm:grid-cols-2">
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
	<span class="text-sm font-medium">{m.weather_forecast_clipping()}</span>
	<p class="text-xs text-muted-foreground">{m.weather_forecast_clipping_desc()}</p>
	<div class="grid gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-max-output">{m.weather_forecast_max_output()}</Label>
			<Input
				id="forecast-max-output"
				bind:value={maxOutput}
				{disabled}
				inputmode="decimal"
				placeholder="10"
			/>
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
				disabled={disabled || battUsable.trim() === ''}
				inputmode="decimal"
				placeholder="5"
			/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-batt-reserve">{m.weather_forecast_battery_reserve()}</Label>
			<Input
				id="forecast-batt-reserve"
				bind:value={battReserve}
				disabled={disabled || battUsable.trim() === ''}
				inputmode="decimal"
				placeholder="10"
			/>
		</div>
	</div>
</div>
