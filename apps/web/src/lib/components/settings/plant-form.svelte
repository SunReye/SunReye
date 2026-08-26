<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Section from '$lib/components/layout/section.svelte';
	import SaveBar from './save-bar.svelte';
	import SolarForecastFields, { type ArrayFields } from './solar-forecast-fields.svelte';
	import { api } from '$lib/api';
	import { parsePlantFields } from '$lib/settings/plant-fields';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';

	// What the plant physically IS: how much PV faces which way, what the grid
	// connection will take, what the battery holds, and whether a smart-meter
	// gateway is installed.
	//
	// These lived on the Weather page because the solar forecast was the first
	// thing to read them. It is no longer the only one — the export limit and the
	// battery drive peak shaving, and the smart-meter date decides whether §51
	// applies at all — so they sit with the inverter, which is what they describe.
	// The forecast still consumes them; it just no longer owns them.
	//
	// They share ONE stored record with the weather settings, and this form sends
	// only the fields above (the server merges). Sending the whole record from two
	// pages is how one page silently undoes the other.
	import type { PlantBattery, PvArray } from '$lib/settings/plant-fields';

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	let loaded = $state(false);
	let saving = $state(false);
	// Numeric fields are bound as text so a half-typed "-" or "" does not coerce
	// to 0; parsed once on save.
	let tempCoeffText = $state('');
	let lossText = $state('');
	let arrayTexts = $state<ArrayFields[]>([]);
	// Power fields are shown in kW (friendlier than the schema's watts) and
	// converted on load/save.
	let maxOutputText = $state('');
	let houseLoadText = $state('');
	let battUsableText = $state('');
	let battChargeText = $state('');
	let battReserveText = $state('');
	// Empty string is the date input's "unset"; the schema wants null.
	let smartMeterText = $state('');

	const fieldsDisabled = $derived(!isAdmin || saving);

	/** Watts as kW text; blank when unset. */
	const wToKw = (w: number | null) => (w == null ? '' : (w / 1000).toString());
	const arrayText = (a: PvArray): ArrayFields => ({
		kwp: a.kwp.toString(),
		tilt: a.tilt.toString(),
		azimuth: a.azimuth.toString()
	});

	/** Blank fields when no battery is described. */
	function batteryTexts(b: PlantBattery | null) {
		if (!b) return { usable: '', charge: '', reserve: '' };
		return { usable: b.usableKwh.toString(), charge: wToKw(b.maxChargeW), reserve: b.minSoc.toString() };
	}

	onMount(async () => {
		const { data } = await api.api.settings.weather.get();
		if (!data) return;
		const f = data.forecast;
		const battery = batteryTexts(f.battery);
		tempCoeffText = f.tempCoefficient.toString();
		lossText = f.systemLoss.toString();
		arrayTexts = f.arrays.map(arrayText);
		maxOutputText = wToKw(f.maxOutputW);
		houseLoadText = wToKw(f.houseLoadW);
		battUsableText = battery.usable;
		battChargeText = battery.charge;
		battReserveText = battery.reserve;
		smartMeterText = f.smartMeterSince ?? '';
		loaded = true;
	});

	async function save() {
		const fields = parsePlantFields({
			arrays: arrayTexts,
			tempCoeff: tempCoeffText,
			loss: lossText,
			maxOutput: maxOutputText,
			houseLoad: houseLoadText,
			battUsable: battUsableText,
			battCharge: battChargeText,
			battReserve: battReserveText,
			smartMeterSince: smartMeterText
		});
		if (!fields) {
			toast.error(m.weather_forecast_toast_invalid());
			return;
		}
		saving = true;
		// Every field named, none spread: this list IS the ownership boundary
		// between this form and the weather one, and a spread hides it from both
		// the reader and the test that pins it.
		const { error } = await api.api.settings.weather.put({
			forecast: {
				arrays: fields.arrays,
				tempCoefficient: fields.tempCoefficient,
				systemLoss: fields.systemLoss,
				maxOutputW: fields.maxOutputW,
				houseLoadW: fields.houseLoadW,
				battery: fields.battery,
				smartMeterSince: fields.smartMeterSince
			}
		});
		saving = false;
		if (error) toast.error(m.plant_toast_error());
		else toast.success(m.plant_toast_saved());
	}
</script>

<SaveBar {isAdmin} {saving} onsave={save} />

<Section title={m.plant_title()} caption={m.plant_desc()}>
	{#if !loaded}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else}
		<SolarForecastFields
			bind:arrays={arrayTexts}
			bind:tempCoeff={tempCoeffText}
			bind:loss={lossText}
			bind:maxOutput={maxOutputText}
			bind:smartMeterSince={smartMeterText}
			bind:houseLoad={houseLoadText}
			bind:battUsable={battUsableText}
			bind:battCharge={battChargeText}
			bind:battReserve={battReserveText}
			disabled={fieldsDisabled}
		/>
	{/if}
</Section>
