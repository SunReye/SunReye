<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Alert from '$lib/components/ui/alert';
	import SettingsSection from './settings-section.svelte';
	import SaveBar from './save-bar.svelte';
	import OptionSelect from './option-select.svelte';
	import { apiErrorText } from './api-error';
	import { api } from '$lib/api';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	type SpotPriceConfig = { enabled: boolean; provider: string; zone: string };
	type Provider = { id: string; zones: readonly string[]; attribution: string };

	let draft = $state<SpotPriceConfig | null>(null);
	let providers = $state<Provider[]>([]);
	let saving = $state(false);

	onMount(async () => {
		const [config, catalog] = await Promise.all([
			api.api.settings['spot-prices'].get(),
			api.api.prices.providers.get()
		]);
		if (config.data) draft = config.data as SpotPriceConfig;
		providers = (catalog.data ?? []) as Provider[];
	});

	const readOnly = $derived(!isAdmin || saving);
	const active = $derived(providers.find((p) => p.id === draft?.provider) ?? null);
	// Zones come from the selected provider so the picker can never offer a market
	// the source doesn't serve — the server rejects that combination anyway.
	const zones = $derived(active?.zones ?? []);
	const zoneItems = $derived(zones.map((z) => ({ value: z, label: z })));
	const providerItems = $derived(providers.map((p) => ({ value: p.id, label: p.id })));

	// Switching source can orphan the chosen zone. Resolving that here rather than
	// in the change handler keeps the reset declarative: what is shown is exactly
	// what will be saved, with no hidden mutation of `draft`.
	const zone = $derived(zones.includes(draft?.zone ?? '') ? (draft?.zone ?? '') : (zones[0] ?? ''));

	// Handlers live here rather than as inline `draft && (...)` guards so the
	// template stays branch-free.
	function setProvider(id: string): void {
		if (draft) draft.provider = id;
	}
	function setZone(next: string): void {
		if (draft) draft.zone = next;
	}

	async function save(): Promise<void> {
		if (!draft) return;
		saving = true;
		const { data, error } = await api.api.settings['spot-prices'].put({ ...draft, zone });
		saving = false;
		if (error) {
			toast.error(apiErrorText(error.value, m.prices_settings_error()));
			return;
		}
		draft = data as SpotPriceConfig;
		toast.success(m.prices_settings_saved());
	}
</script>

<div class="flex flex-col gap-6">
	<SaveBar {isAdmin} {saving} disabled={!draft} onsave={save} />

	<SettingsSection title={m.prices_settings_title()}>
		<p class="text-sm text-muted-foreground">{m.prices_settings_intro()}</p>

		{#if draft}
			<div class="flex items-center justify-between gap-4">
				<Label for="spot-enabled">{m.prices_settings_enable()}</Label>
				<Switch id="spot-enabled" bind:checked={draft.enabled} disabled={readOnly} />
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="spot-provider">{m.prices_settings_provider()}</Label>
					<OptionSelect
						value={draft.provider}
						items={providerItems}
						onchange={setProvider}
						triggerClass="w-full"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="spot-zone">{m.prices_settings_zone()}</Label>
					<OptionSelect
						value={zone}
						items={zoneItems}
						onchange={setZone}
						triggerClass="w-full"
					/>
				</div>
			</div>

			<Alert.Root>
				<Alert.Description>{m.prices_settings_publication()}</Alert.Description>
			</Alert.Root>

			{#if active}
				<!-- CC BY 4.0 for the default source: the credit is a licence
				     condition, so it is shown wherever the source is chosen. -->
				<p class="text-xs text-muted-foreground">{active.attribution}</p>
			{/if}
		{/if}
	</SettingsSection>
</div>
