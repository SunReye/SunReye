<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import FieldInfo from './field-info.svelte';
	import * as m from '$lib/paraglide/messages';

	// The pack an INVERTER carries. The charge cap, reserve and voltage only apply
	// once a usable capacity is given; blank capacity means "no battery".
	let {
		battUsable = $bindable(),
		battCharge = $bindable(),
		battReserve = $bindable(),
		battNominalV = $bindable(),
		disabled
	}: {
		/** Usable battery energy, kWh (blank = no battery). */
		battUsable: string;
		/** Max charge power, kW (blank = unbounded). */
		battCharge: string;
		/** Reserve floor, % (blank = 10). */
		battReserve: string;
		/** Nominal pack voltage, V — blank keeps whatever the automation had. */
		battNominalV: string;
		disabled: boolean;
	} = $props();

	const battDisabled = $derived(disabled || battUsable.trim() === '');
</script>

<div class="flex flex-col gap-2">
	<span class="text-sm font-medium">{m.devices_battery_heading()}</span>
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-batt-usable">{m.weather_forecast_battery_usable()}</Label>
			<Input id="forecast-batt-usable" bind:value={battUsable} {disabled} inputmode="decimal" placeholder="10" />
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-batt-charge">{m.weather_forecast_battery_charge()}</Label>
			<Input id="forecast-batt-charge" bind:value={battCharge} disabled={battDisabled} inputmode="decimal" placeholder="5" />
		</div>
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-batt-reserve">{m.weather_forecast_battery_reserve()}</Label>
			<Input id="forecast-batt-reserve" bind:value={battReserve} disabled={battDisabled} inputmode="decimal" placeholder="10" />
		</div>
		<div class="flex flex-col gap-1.5">
			<div class="flex items-center gap-1.5">
				<Label for="forecast-batt-nominal-v">{m.plant_battery_nominal_v()}</Label>
				<FieldInfo label={m.plant_battery_nominal_v()} info={m.plant_battery_nominal_v_desc()} />
			</div>
			<Input id="forecast-batt-nominal-v" bind:value={battNominalV} disabled={battDisabled} inputmode="decimal" placeholder="51.2" />
		</div>
	</div>
</div>
