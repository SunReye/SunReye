<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import Section from '$lib/components/layout/section.svelte';
	import SaveBar from './save-bar.svelte';
	import FieldInfo from './field-info.svelte';
	import ForecastCorrectionPanel from './forecast-correction-panel.svelte';
	import OptionSelect from './option-select.svelte';
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
			smartMeterSince: string | null;
			correction: { enabled: boolean };
		};
	};

	type Provider = { id: string; label: string; capabilities: { dni: boolean; windSpeed: boolean } };

	let draft = $state<WeatherConfig | null>(null);
	let providers = $state<Provider[]>([]);
	let saving = $state(false);
	// All numeric fields are bound as text so a half-typed "-" or "" doesn't
	// coerce to 0; parsed once on save.
	let latText = $state('');
	let lonText = $state('');

	const fieldsDisabled = $derived(!isAdmin || saving);
	const providerItems = $derived(providers.map((p) => ({ value: p.id, label: p.label })));

	// --- Loading: config → input text ---------------------------------------

	const numText = (n: number | null) => n?.toString() ?? '';

	function loadTexts(config: WeatherConfig) {
		latText = numText(config.latitude);
		lonText = numText(config.longitude);
	}

	onMount(async () => {
		const [config, catalog] = await Promise.all([
			api.api.settings.weather.get(),
			api.api.forecast.providers.get()
		]);
		providers = (catalog.data ?? []) as Provider[];
		if (!config.data) return;
		draft = config.data as WeatherConfig;
		loadTexts(draft);
	});

	// --- Saving: input text → config ----------------------------------------

	/** Coordinates only have to parse once the tile is switched on. */
	function coordsInvalid(enabled: boolean, latitude: number | null, longitude: number | null) {
		return enabled && (latitude === null || longitude === null);
	}

	async function put(latitude: number | null, longitude: number | null) {
		if (!draft) return;
		saving = true;
		// Only the fields this form owns. The plant's own description — arrays,
		// export limit, battery, smart-meter date — shares this record but is
		// edited with the inverter, and the server merges rather than replacing,
		// so neither page can write back the other's stale values.
		const { data, error } = await api.api.settings.weather.put({
			enabled: draft.enabled,
			latitude,
			longitude,
			label: draft.label,
			forecast: {
				enabled: draft.forecast.enabled,
				provider: draft.forecast.provider,
				correction: draft.forecast.correction
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
		await put(latitude, longitude);
	}

	// Switches write through the draft; the guard keeps the handlers callable
	// before the config has loaded.
	function setEnabled(v: boolean) {
		if (draft) draft.enabled = v;
	}
	function setForecastEnabled(v: boolean) {
		if (draft) draft.forecast.enabled = v;
	}
	function setProvider(id: string) {
		if (draft) draft.forecast.provider = id;
	}
	function setCorrectionEnabled(v: boolean) {
		if (draft) draft.forecast.correction.enabled = v;
	}
</script>

<SaveBar {isAdmin} {saving} disabled={!draft} onsave={save} />

<Section title={m.weather_title()}>
	{#if !draft}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else}
		<div class="flex items-center justify-between gap-4">
			<Label for="weather-enabled">{m.weather_show_tile()}</Label>
			<Switch
				id="weather-enabled"
				checked={draft.enabled}
				disabled={fieldsDisabled}
				onCheckedChange={setEnabled}
			/>
		</div>

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
				<div class="flex items-center gap-1.5">
					<Label for="forecast-enabled">{m.weather_forecast_enable()}</Label>
					<FieldInfo label={m.weather_forecast_enable()} info={m.weather_forecast_desc()} />
				</div>
				<Switch
					id="forecast-enabled"
					checked={draft.forecast.enabled}
					disabled={fieldsDisabled}
					onCheckedChange={setForecastEnabled}
				/>
			</div>
		</div>

		{#if draft.forecast.enabled}
			<div class="flex flex-col gap-1.5">
				<Label for="forecast-provider">{m.weather_forecast_provider()}</Label>
				<OptionSelect
					value={draft.forecast.provider}
					items={providerItems}
					onchange={setProvider}
					triggerClass="w-full"
				/>
			</div>

			<p class="text-sm text-muted-foreground">{m.weather_forecast_plant_hint()}</p>

			<Separator />

			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between gap-4">
					<div class="flex items-center gap-1.5">
						<Label for="correction-enabled">{m.weather_forecast_correction()}</Label>
						<FieldInfo
							label={m.weather_forecast_correction()}
							info={m.weather_forecast_correction_desc()}
						/>
					</div>
					<Switch
						id="correction-enabled"
						checked={draft.forecast.correction.enabled}
						disabled={fieldsDisabled}
						onCheckedChange={setCorrectionEnabled}
					/>
				</div>
			</div>

			<ForecastCorrectionPanel />
		{/if}
	{/if}
</Section>
