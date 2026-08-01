<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Alert from '$lib/components/ui/alert';
	import OptionSelect from './option-select.svelte';
	import type { TariffDraft } from '$lib/tariff/draft';
	import * as m from '$lib/paraglide/messages';

	// The market-linked half of the tariff: how export is remunerated when the
	// day-ahead price is known, and what a market price lands at on the bill.
	let { tariff = $bindable() }: { tariff: TariffDraft } = $props();

	const MODELS = [
		{ value: 'none', label: m.tariff_marketing_none() },
		{ value: 'eegFeedIn', label: m.tariff_marketing_eeg() },
		{ value: 'direktvermarktung', label: m.tariff_marketing_direkt() }
	];

	const model = $derived(tariff.export.spot.marketingModel);
	const isDirekt = $derived(model === 'direktvermarktung');
	const importSpot = $derived(tariff.import.mode === 'spot');

	/**
	 * `export.mode` is not a second switch the user has to find: it follows the
	 * marketing model, since "spot mode with model none" would be a setting that
	 * does nothing.
	 */
	function setModel(next: string): void {
		tariff.export.spot.marketingModel = next as TariffDraft['export']['spot']['marketingModel'];
		tariff.export.mode = next === 'none' ? 'static' : 'spot';
	}

	function setImportSpot(next: boolean): void {
		tariff.import.mode = next ? 'spot' : 'static';
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-1.5">
		<Label for="marketing-model">{m.tariff_marketing_model()}</Label>
		<OptionSelect
			value={model}
			items={MODELS}
			onchange={setModel}
			triggerClass="w-full sm:max-w-80"
		/>
		<span class="text-xs text-muted-foreground">{m.tariff_marketing_desc()}</span>
	</div>

	{#if isDirekt}
		<div class="flex flex-col gap-1.5">
			<Label for="mgmt-fee">{m.tariff_management_fee()}</Label>
			<Input
				id="mgmt-fee"
				type="number"
				step="0.001"
				bind:value={tariff.export.spot.managementFeePerKwh}
				class="max-w-40"
			/>
			<span class="text-xs text-muted-foreground">{m.tariff_management_fee_desc()}</span>
		</div>
	{/if}

	<Alert.Root>
		<Alert.Description>{m.tariff_marketing_hint()}</Alert.Description>
	</Alert.Root>

	<div class="flex items-center justify-between gap-4 border-t border-border pt-4">
		<div class="flex flex-col gap-0.5">
			<Label for="import-spot">{m.tariff_import_follows_market()}</Label>
			<span class="text-xs text-muted-foreground">{m.tariff_import_follows_market_desc()}</span>
		</div>
		<Switch id="import-spot" checked={importSpot} onCheckedChange={setImportSpot} />
	</div>

	{#if importSpot}
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5">
				<Label for="markup">{m.tariff_supplier_markup()}</Label>
				<Input
					id="markup"
					type="number"
					step="0.001"
					bind:value={tariff.import.spot.supplierMarkupPerKwh}
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="grid-fees">{m.tariff_grid_fees()}</Label>
				<Input
					id="grid-fees"
					type="number"
					step="0.001"
					bind:value={tariff.import.spot.gridFeesPerKwh}
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="levies">{m.tariff_levies()}</Label>
				<Input id="levies" type="number" step="0.001" bind:value={tariff.import.spot.leviesPerKwh} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="vat">{m.tariff_vat_percent()}</Label>
				<Input id="vat" type="number" step="0.1" bind:value={tariff.import.spot.vatPercent} />
			</div>
		</div>
	{/if}
</div>
