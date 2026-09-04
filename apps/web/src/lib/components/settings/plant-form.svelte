<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Section from '$lib/components/layout/section.svelte';
	import SaveBar from './save-bar.svelte';
	import PlantSiteFields from './plant-site-fields.svelte';
	import { api } from '$lib/api';
	import { parsePlantFields, plantTextsFrom } from '$lib/settings/plant-fields';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';

	// What the SITE is: what the grid connection will take, the house's baseline
	// draw, and whether a smart-meter gateway is installed. The roof and the pack
	// used to be here too; they describe an inverter and are edited on its device
	// (Settings → Devices) — one plant-wide set could not say whose strings were
	// whose once there were two.
	//
	// These share ONE stored record with the weather settings, and this form sends
	// only the fields it owns (the server merges, and refuses the inverter's).

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	let loaded = $state(false);
	let saving = $state(false);
	// Power fields are shown in kW and converted on load/save; bound as text so a
	// half-typed value does not coerce to 0.
	let maxOutputText = $state('');
	let houseLoadText = $state('');
	// Empty string is the date input's "unset"; the schema wants null.
	let smartMeterText = $state('');
	/** Installed kWp across every in-service inverter, for the export-cap helper. */
	let totalKwp = $state(0);

	const fieldsDisabled = $derived(!isAdmin || saving);

	onMount(async () => {
		const { data } = await api.api.settings.weather.get();
		if (!data) return;
		const texts = plantTextsFrom(data.forecast);
		maxOutputText = texts.maxOutput;
		houseLoadText = texts.houseLoad;
		smartMeterText = texts.smartMeterSince;
		// The composed forecast arrays are every inverter's, already stamped.
		totalKwp = data.forecast.arrays.reduce((sum, a) => sum + a.kwp, 0);
		loaded = true;
	});

	async function save() {
		const fields = parsePlantFields({
			maxOutput: maxOutputText,
			houseLoad: houseLoadText,
			smartMeterSince: smartMeterText
		});
		if (!fields) {
			toast.error(m.weather_forecast_toast_invalid());
			return;
		}
		saving = true;
		// Every field named, none spread: this list IS the ownership boundary
		// between this form, the weather one and the device dialog, and a spread
		// hides it from both the reader and the test that pins it.
		const { error } = await api.api.settings.weather.put({
			forecast: {
				maxOutputW: fields.maxOutputW,
				houseLoadW: fields.houseLoadW,
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
		<PlantSiteFields
			bind:maxOutput={maxOutputText}
			bind:houseLoad={houseLoadText}
			bind:smartMeterSince={smartMeterText}
			{totalKwp}
			disabled={fieldsDisabled}
		/>
	{/if}
</Section>
