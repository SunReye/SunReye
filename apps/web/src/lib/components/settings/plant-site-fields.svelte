<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import FieldInfo from './field-info.svelte';
	import ExportCapHelper from './export-cap-helper.svelte';
	import * as m from '$lib/paraglide/messages';

	// The site facts the plant still owns: the grid connection's ceiling, the
	// house's baseline draw, and the smart-meter date that decides whether §51
	// applies. The roof and the pack are the inverter's (Settings → Devices).
	let {
		maxOutput = $bindable(),
		houseLoad = $bindable(),
		smartMeterSince = $bindable(),
		totalKwp,
		disabled
	}: {
		/** Max grid feed-in, kW (blank = no export limit). */
		maxOutput: string;
		/** Avg house load, kW (blank = infer median from history). */
		houseLoad: string;
		/** Smart-meter-gateway install date, `YYYY-MM-DD`, or '' when none. */
		smartMeterSince: string;
		/** Installed DC capacity across every inverter, kWp — for the cap helper. */
		totalKwp: number;
		disabled: boolean;
	} = $props();
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-center gap-1.5">
		<span class="text-sm font-medium">{m.weather_forecast_clipping()}</span>
		<FieldInfo label={m.weather_forecast_clipping()} info={m.weather_forecast_clipping_desc()} />
	</div>
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<div class="flex flex-col gap-1.5">
			<Label for="forecast-max-output">{m.weather_forecast_max_output()}</Label>
			<Input id="forecast-max-output" bind:value={maxOutput} {disabled} inputmode="decimal" placeholder="10" />
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
	</div>
</div>
