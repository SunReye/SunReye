<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import SettingsSection from './settings-section.svelte';
	import ActionBar from './action-bar.svelte';
	import TariffBandDays from './tariff-band-days.svelte';
	import TariffSpotFields from './tariff-spot-fields.svelte';
	import {
		ALL_DAYS,
		type BandDraft,
		type TariffDraft,
		type TariffResponse
	} from '$lib/tariff/draft';
	import PlusIcon from 'phosphor-svelte/lib/Plus';
	import TrashIcon from 'phosphor-svelte/lib/Trash';
	import * as m from '$lib/paraglide/messages';

	// `null` until the config has loaded — there is no other empty state.
	let tariff = $state<TariffDraft | null>(null);
	let saving = $state(false);

	// Bands may omit `days` (= every day); normalize to a full array for editing.
	const toBand = (b: TariffResponse['import']['bands'][number]): BandDraft => ({
		name: b.name,
		pricePerKwh: b.pricePerKwh,
		startHour: b.startHour,
		endHour: b.endHour,
		days: b.days ?? ALL_DAYS
	});

	/** The response, with only the bands reshaped; every other field carried through. */
	const toTariff = (data: TariffResponse): TariffDraft => ({
		...data,
		import: { ...data.import, bands: (data.import.bands ?? []).map(toBand) }
	});

	onMount(async () => {
		const { data } = await api.api.settings.tariff.get();
		// Deliberately stays null on a failed read: offering to overwrite a tariff
		// we could not read is how a stored config gets wiped.
		if (data) tariff = toTariff(data);
	});

	function addBand() {
		tariff?.import.bands.push({
			name: 'Peak',
			pricePerKwh: 0,
			startHour: 8,
			endHour: 20,
			days: [1, 2, 3, 4, 5]
		});
	}

	function removeBand(i: number) {
		tariff?.import.bands.splice(i, 1);
	}

	const saveLabel = $derived(saving ? m.action_saving() : m.tariff_save());

	async function save() {
		if (!tariff) return;
		saving = true;
		// A band covering all 7 days sends no `days` (semantically "every day").
		const payload = {
			...tariff,
			import: {
				...tariff.import,
				bands: tariff.import.bands.map((b) => ({
					name: b.name,
					pricePerKwh: b.pricePerKwh,
					startHour: b.startHour,
					endHour: b.endHour,
					...(b.days.length > 0 && b.days.length < 7 ? { days: b.days } : {})
				}))
			}
		};
		const { error } = await api.api.settings.tariff.put(payload);
		saving = false;
		if (error) toast.error(m.tariff_toast_error());
		else toast.success(m.tariff_toast_saved());
	}
</script>

{#if !tariff}
	<div class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground">
		{m.tariff_loading()}
	</div>
{:else}
	<ActionBar>
		<Button onclick={save} disabled={saving}>
			{saveLabel}
		</Button>
	</ActionBar>

	<SettingsSection title={m.tariff_general()}>
		<div class="grid gap-4 sm:grid-cols-3">
			<div class="flex flex-col gap-1.5">
				<Label for="currency">{m.tariff_currency()}</Label>
				<Input id="currency" maxlength={3} bind:value={tariff.currency} class="uppercase" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="standing">{m.tariff_standing_charge()}</Label>
				<Input id="standing" type="number" step="0.01" bind:value={tariff.standingChargeMonthly} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="feedin">{m.tariff_feed_in()}</Label>
				<Input id="feedin" type="number" step="0.001" bind:value={tariff.export.feedInPerKwh} />
			</div>
		</div>
	</SettingsSection>

	<SettingsSection title={m.tariff_market_prices()}>
		<TariffSpotFields bind:tariff />
	</SettingsSection>

	<SettingsSection title={m.tariff_import_price()}>
		{#snippet actions()}
			<Button variant="ghost" size="sm" onclick={addBand}>
				<PlusIcon class="size-4" /> {m.tariff_add_band()}
			</Button>
		{/snippet}

		<div class="flex flex-col gap-1.5">
			<Label for="default-price">{m.tariff_default_price()}</Label>
			<Input
				id="default-price"
				type="number"
				step="0.001"
				bind:value={tariff.import.defaultPricePerKwh}
				class="max-w-40"
			/>
			<span class="text-xs text-muted-foreground">
				{m.tariff_default_price_desc()}
			</span>
		</div>

		{#if tariff.import.bands.length === 0}
			<p class="text-sm text-muted-foreground">
				{m.tariff_flat_rate_desc()}
			</p>
		{/if}

		{#each tariff.import.bands as band, i (i)}
			<div class="flex flex-col gap-3 border border-border p-3">
				<div class="flex items-end gap-3">
					<div class="flex flex-1 flex-col gap-1.5">
						<Label>{m.auth_field_name()}</Label>
						<Input bind:value={band.name} />
					</div>
					<div class="flex w-28 flex-col gap-1.5">
						<Label>{m.tariff_price()}</Label>
						<Input type="number" step="0.001" bind:value={band.pricePerKwh} />
					</div>
					<div class="flex w-20 flex-col gap-1.5">
						<Label>{m.tariff_from_h()}</Label>
						<Input type="number" min="0" max="23" bind:value={band.startHour} />
					</div>
					<div class="flex w-20 flex-col gap-1.5">
						<Label>{m.tariff_to_h()}</Label>
						<Input type="number" min="1" max="24" bind:value={band.endHour} />
					</div>
					<Button variant="ghost" size="icon" onclick={() => removeBand(i)} aria-label={m.tariff_remove_band()}>
						<TrashIcon class="size-4" />
					</Button>
				</div>
				<TariffBandDays bind:days={band.days} />
			</div>
		{/each}
	</SettingsSection>
{/if}
