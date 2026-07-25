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

	onMount(async () => {
		const { data } = await api.api.settings.weather.get();
		if (data) {
			draft = data as WeatherConfig;
			latText = draft.latitude?.toString() ?? '';
			lonText = draft.longitude?.toString() ?? '';
			tempCoeffText = draft.forecast.tempCoefficient.toString();
			lossText = draft.forecast.systemLoss.toString();
			arrayTexts = draft.forecast.arrays.map((a) => ({
				kwp: a.kwp.toString(),
				tilt: a.tilt.toString(),
				azimuth: a.azimuth.toString()
			}));
			const wToKw = (w: number | null) => (w == null ? '' : (w / 1000).toString());
			maxOutputText = wToKw(draft.forecast.maxOutputW);
			houseLoadText = wToKw(draft.forecast.houseLoadW);
			battUsableText = draft.forecast.battery ? draft.forecast.battery.usableKwh.toString() : '';
			battChargeText = wToKw(draft.forecast.battery?.maxChargeW ?? null);
			battReserveText = draft.forecast.battery ? draft.forecast.battery.minSoc.toString() : '';
		}
	});

	function parseNum(text: string): number | null {
		const t = text.trim();
		if (t === '') return null;
		const n = Number(t);
		return Number.isFinite(n) ? n : null;
	}

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

	/** Parse the forecast inputs, or null (with a toast) when any is invalid. */
	function parseForecast(): ForecastFields | null {
		const arrays: PvArray[] = [];
		for (const t of arrayTexts) {
			const kwp = parseNum(t.kwp);
			const tilt = parseNum(t.tilt);
			const azimuth = parseNum(t.azimuth);
			if (kwp === null || tilt === null || azimuth === null) return null;
			arrays.push({ kwp, tilt, azimuth });
		}
		const tempCoefficient = parseNum(tempCoeffText);
		const systemLoss = parseNum(lossText);
		if (tempCoefficient === null || systemLoss === null) return null;

		const maxOut = parseOptionalKw(maxOutputText);
		const load = parseOptionalKw(houseLoadText);
		const charge = parseOptionalKw(battChargeText);
		if (!maxOut.ok || !load.ok || !charge.ok) return null;

		// The battery block exists only when a usable capacity is given; the reserve
		// then defaults to 10% and the charge cap is optional.
		let battery: ForecastBattery | null = null;
		if (battUsableText.trim() !== '') {
			const usableKwh = parseNum(battUsableText);
			if (usableKwh === null) return null;
			const minSoc = battReserveText.trim() === '' ? 10 : parseNum(battReserveText);
			if (minSoc === null) return null;
			battery = { usableKwh, maxChargeW: charge.watts, minSoc };
		}

		return {
			arrays,
			tempCoefficient,
			systemLoss,
			maxOutputW: maxOut.watts,
			battery,
			houseLoadW: load.watts
		};
	}

	async function save() {
		if (!draft) return;
		const latitude = parseNum(latText);
		const longitude = parseNum(lonText);
		if (draft.enabled && (latitude === null || longitude === null)) {
			toast.error(m.weather_toast_invalid_coords());
			return;
		}
		const forecast = parseForecast();
		if (!forecast) {
			toast.error(m.weather_forecast_toast_invalid());
			return;
		}

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
				disabled={!isAdmin || saving}
				onCheckedChange={(v) => draft && (draft.enabled = v)}
			/>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="weather-lat">{m.weather_latitude()}</Label>
				<Input
					id="weather-lat"
					bind:value={latText}
					disabled={!isAdmin || saving}
					inputmode="decimal"
					placeholder="50.39"
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="weather-lon">{m.weather_longitude()}</Label>
				<Input
					id="weather-lon"
					bind:value={lonText}
					disabled={!isAdmin || saving}
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
				disabled={!isAdmin || saving}
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
					disabled={!isAdmin || saving}
					onCheckedChange={(v) => draft && (draft.forecast.enabled = v)}
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
				disabled={!isAdmin || saving}
			/>

			<Separator />

			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between gap-4">
					<Label for="correction-enabled">{m.weather_forecast_correction()}</Label>
					<Switch
						id="correction-enabled"
						checked={draft.forecast.correction.enabled}
						disabled={!isAdmin || saving}
						onCheckedChange={(v) => draft && (draft.forecast.correction.enabled = v)}
					/>
				</div>
				<p class="text-sm text-muted-foreground">{m.weather_forecast_correction_desc()}</p>
			</div>

			<ForecastCorrectionPanel />
		{/if}
	{/if}
</SettingsSection>
