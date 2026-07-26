<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import SettingsSection from './settings-section.svelte';
	import SaveBar from './save-bar.svelte';
	import SolarForecastFields, { type ArrayFields } from './solar-forecast-fields.svelte';
	import ForecastCorrectionPanel from './forecast-correction-panel.svelte';
	import { api } from '$lib/api';
	import { parseNum } from '$lib/parse-num';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	type PvArray = { kwp: number; tilt: number; azimuth: number };
	type ForecastBattery = { usableKwh: number; maxChargeW: number | null; minSoc: number };
	type WeatherConfig = {
		enabled: boolean;
		latitude: number | null;
		longitude: number | null;
		label: string;
		forecast: {
			enabled: boolean;
			provider: string;
			arrays: PvArray[];
			tempCoefficient: number;
			systemLoss: number;
			maxOutputW: number | null;
			battery: ForecastBattery | null;
			houseLoadW: number | null;
			correction: { enabled: boolean };
		};
	};

	let draft = $state<WeatherConfig | null>(null);
	let saving = $state(false);
	// All numeric fields are bound as text so a half-typed "-" or "" doesn't
	// coerce to 0; parsed once on save.
	let latText = $state('');
	let lonText = $state('');
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

	const fieldsDisabled = $derived(!isAdmin || saving);

	// --- Loading: config → input text ---------------------------------------

	/** Watts as kW text; blank when unset. */
	const wToKw = (w: number | null) => (w == null ? '' : (w / 1000).toString());
	const numText = (n: number | null) => n?.toString() ?? '';
	const arrayText = (a: PvArray): ArrayFields => ({
		kwp: a.kwp.toString(),
		tilt: a.tilt.toString(),
		azimuth: a.azimuth.toString()
	});

	/** Blank fields when the forecast carries no battery model. */
	function batteryTexts(b: ForecastBattery | null) {
		if (!b) return { usable: '', charge: '', reserve: '' };
		return {
			usable: b.usableKwh.toString(),
			charge: wToKw(b.maxChargeW),
			reserve: b.minSoc.toString()
		};
	}

	function loadTexts(config: WeatherConfig) {
		const f = config.forecast;
		const battery = batteryTexts(f.battery);
		latText = numText(config.latitude);
		lonText = numText(config.longitude);
		tempCoeffText = f.tempCoefficient.toString();
		lossText = f.systemLoss.toString();
		arrayTexts = f.arrays.map(arrayText);
		maxOutputText = wToKw(f.maxOutputW);
		houseLoadText = wToKw(f.houseLoadW);
		battUsableText = battery.usable;
		battChargeText = battery.charge;
		battReserveText = battery.reserve;
	}

	onMount(async () => {
		const { data } = await api.api.settings.weather.get();
		if (!data) return;
		draft = data as WeatherConfig;
		loadTexts(draft);
	});

	// --- Saving: input text → config ----------------------------------------

	type ForecastFields = {
		arrays: PvArray[];
		tempCoefficient: number;
		systemLoss: number;
		maxOutputW: number | null;
		battery: ForecastBattery | null;
		houseLoadW: number | null;
	};

	/** A blank field is a valid "unset"; a filled-but-unparseable one is not. */
	function parseOptionalKw(text: string): { ok: boolean; watts: number | null } {
		if (text.trim() === '') return { ok: true, watts: null };
		const kw = parseNum(text);
		return kw === null ? { ok: false, watts: null } : { ok: true, watts: kw * 1000 };
	}

	function parseArray(t: ArrayFields): PvArray | null {
		const kwp = parseNum(t.kwp);
		const tilt = parseNum(t.tilt);
		const azimuth = parseNum(t.azimuth);
		if (kwp === null || tilt === null || azimuth === null) return null;
		return { kwp, tilt, azimuth };
	}

	function parseArrays(): PvArray[] | null {
		const arrays: PvArray[] = [];
		for (const t of arrayTexts) {
			const parsed = parseArray(t);
			if (parsed === null) return null;
			arrays.push(parsed);
		}
		return arrays;
	}

	/** The array geometry plus the two loss coefficients; null if any is invalid. */
	function parseArrayFields() {
		const arrays = parseArrays();
		const tempCoefficient = parseNum(tempCoeffText);
		const systemLoss = parseNum(lossText);
		if (arrays === null || tempCoefficient === null || systemLoss === null) return null;
		return { arrays, tempCoefficient, systemLoss };
	}

	/** The blank-allowed power fields in watts; null if any is filled but invalid. */
	function parsePowerFields() {
		const maxOut = parseOptionalKw(maxOutputText);
		const load = parseOptionalKw(houseLoadText);
		const charge = parseOptionalKw(battChargeText);
		if (![maxOut, load, charge].every((f) => f.ok)) return null;
		return { maxOutputW: maxOut.watts, houseLoadW: load.watts, maxChargeW: charge.watts };
	}

	/** Reserve floor, defaulting to 10% when left blank. */
	function parseReserve(): number | null {
		if (battReserveText.trim() === '') return 10;
		return parseNum(battReserveText);
	}

	// The battery block exists only when a usable capacity is given; the reserve
	// then defaults to 10% and the charge cap is optional.
	function parseBattery(maxChargeW: number | null): { ok: boolean; battery: ForecastBattery | null } {
		if (battUsableText.trim() === '') return { ok: true, battery: null };
		const usableKwh = parseNum(battUsableText);
		const minSoc = parseReserve();
		if (usableKwh === null || minSoc === null) return { ok: false, battery: null };
		return { ok: true, battery: { usableKwh, maxChargeW, minSoc } };
	}

	/** Parse the forecast inputs, or null when any is invalid. */
	function parseForecast(): ForecastFields | null {
		const fields = parseArrayFields();
		const power = parsePowerFields();
		if (fields === null || power === null) return null;
		const battery = parseBattery(power.maxChargeW);
		if (!battery.ok) return null;
		return {
			...fields,
			maxOutputW: power.maxOutputW,
			houseLoadW: power.houseLoadW,
			battery: battery.battery
		};
	}

	/** Coordinates only have to parse once the tile is switched on. */
	function coordsInvalid(enabled: boolean, latitude: number | null, longitude: number | null) {
		return enabled && (latitude === null || longitude === null);
	}

	async function put(latitude: number | null, longitude: number | null, forecast: ForecastFields) {
		if (!draft) return;
		saving = true;
		const { data, error } = await api.api.settings.weather.put({
			enabled: draft.enabled,
			latitude,
			longitude,
			label: draft.label,
			forecast: {
				enabled: draft.forecast.enabled,
				provider: draft.forecast.provider,
				correction: draft.forecast.correction,
				...forecast
			}
		});
		saving = false;
		if (error) toast.error(m.weather_toast_error());
		else {
			draft = data as WeatherConfig;
			toast.success(m.weather_toast_saved());
		}
	}

	async function save() {
		if (!draft) return;
		const latitude = parseNum(latText);
		const longitude = parseNum(lonText);
		if (coordsInvalid(draft.enabled, latitude, longitude)) {
			toast.error(m.weather_toast_invalid_coords());
			return;
		}
		const forecast = parseForecast();
		if (!forecast) {
			toast.error(m.weather_forecast_toast_invalid());
			return;
		}
		await put(latitude, longitude, forecast);
	}

	// Switches write through the draft; the guard keeps the handlers callable
	// before the config has loaded.
	function setEnabled(v: boolean) {
		if (draft) draft.enabled = v;
	}
	function setForecastEnabled(v: boolean) {
		if (draft) draft.forecast.enabled = v;
	}
	function setCorrectionEnabled(v: boolean) {
		if (draft) draft.forecast.correction.enabled = v;
	}
</script>

<SaveBar {isAdmin} {saving} disabled={!draft} onsave={save} />

<SettingsSection title={m.weather_title()}>
	{#if !draft}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else}
		<p class="text-sm text-muted-foreground">
			{m.weather_desc()}
		</p>

		<div class="flex items-center justify-between gap-4">
			<Label for="weather-enabled">{m.weather_show_tile()}</Label>
			<Switch
				id="weather-enabled"
				checked={draft.enabled}
				disabled={fieldsDisabled}
				onCheckedChange={setEnabled}
			/>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="weather-lat">{m.weather_latitude()}</Label>
				<Input
					id="weather-lat"
					bind:value={latText}
					disabled={fieldsDisabled}
					inputmode="decimal"
					placeholder="50.39"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="weather-lon">{m.weather_longitude()}</Label>
				<Input
					id="weather-lon"
					bind:value={lonText}
					disabled={fieldsDisabled}
					inputmode="decimal"
					placeholder="8.06"
				/>
			</div>
		</div>

		<div class="flex flex-col gap-1.5">
			<Label for="weather-label">{m.weather_location_name()}</Label>
			<Input
				id="weather-label"
				bind:value={draft.label}
				disabled={fieldsDisabled}
				placeholder="Limburg-Weilburg"
				maxlength={120}
			/>
		</div>

		<Separator />

		<div class="flex flex-col gap-1">
			<div class="flex items-center justify-between gap-4">
				<Label for="forecast-enabled">{m.weather_forecast_enable()}</Label>
				<Switch
					id="forecast-enabled"
					checked={draft.forecast.enabled}
					disabled={fieldsDisabled}
					onCheckedChange={setForecastEnabled}
				/>
			</div>
			<p class="text-sm text-muted-foreground">{m.weather_forecast_desc()}</p>
		</div>

		{#if draft.forecast.enabled}
			<SolarForecastFields
				bind:arrays={arrayTexts}
				bind:tempCoeff={tempCoeffText}
				bind:loss={lossText}
				bind:maxOutput={maxOutputText}
				bind:houseLoad={houseLoadText}
				bind:battUsable={battUsableText}
				bind:battCharge={battChargeText}
				bind:battReserve={battReserveText}
				disabled={fieldsDisabled}
			/>

			<Separator />

			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between gap-4">
					<Label for="correction-enabled">{m.weather_forecast_correction()}</Label>
					<Switch
						id="correction-enabled"
						checked={draft.forecast.correction.enabled}
						disabled={fieldsDisabled}
						onCheckedChange={setCorrectionEnabled}
					/>
				</div>
				<p class="text-sm text-muted-foreground">{m.weather_forecast_correction_desc()}</p>
			</div>

			<ForecastCorrectionPanel />
		{/if}
	{/if}
</SettingsSection>
