<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Separator } from '$lib/components/ui/separator';
	import * as Alert from '$lib/components/ui/alert';
	import SettingsSection from '$lib/components/settings/settings-section.svelte';
	import SaveBar from '$lib/components/settings/save-bar.svelte';
	import OptionSelect from '$lib/components/settings/option-select.svelte';
	import BlockerAlert from './blocker-alert.svelte';
	import { api } from '$lib/api';
	import { parseNum } from '$lib/parse-num';
	import { resolve } from '$lib/resolve';
	import { useAppSession } from '$lib/session';
	import * as m from '$lib/paraglide/messages';
	import type { AutomationConfig, PeakShavingStatus } from '$lib/automations';

	type PeakShavingMode = AutomationConfig['peakShaving']['mode'];

	let { status }: { status: PeakShavingStatus | null } = $props();

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	type NumKey = keyof typeof nums;

	let draft = $state<AutomationConfig | null>(null);
	let saving = $state(false);
	// Numeric fields ride as text so a half-typed value doesn't coerce to 0.
	let nums = $state({
		safetyBufferW: '',
		maxChargeA: '',
		fallbackChargeA: '',
		topBalanceFloorA: '',
		nominalBatteryV: ''
	});

	const numFields = $derived([
		{ key: 'safetyBufferW' as NumKey, label: m.peak_shaving_buffer(), desc: m.peak_shaving_buffer_desc(), placeholder: '500' },
		{ key: 'maxChargeA' as NumKey, label: m.peak_shaving_max_charge(), desc: m.peak_shaving_max_charge_desc(), placeholder: '100' },
		{ key: 'fallbackChargeA' as NumKey, label: m.peak_shaving_fallback(), desc: m.peak_shaving_fallback_desc(), placeholder: '50' },
		{ key: 'topBalanceFloorA' as NumKey, label: m.peak_shaving_floor(), desc: m.peak_shaving_floor_desc(), placeholder: '5' },
		{ key: 'nominalBatteryV' as NumKey, label: m.peak_shaving_voltage(), desc: m.peak_shaving_voltage_desc(), placeholder: '51.2' }
	]);

	onMount(async () => {
		const { data } = await api.api.settings.automations.get();
		if (!data) return;
		draft = data as AutomationConfig;
		for (const f of Object.keys(nums) as NumKey[]) {
			nums[f] = draft.peakShaving[f].toString();
		}
	});

	const blockers = $derived(status?.blockers ?? []);
	// Turning the automation ON needs a runnable setup; turning it OFF must
	// always stay possible.
	const enableLocked = $derived(
		draft !== null && !draft.peakShaving.enabled && blockers.length > 0
	);
	const modeDesc = $derived(
		draft?.peakShaving.mode === 'grid-friendly'
			? m.peak_shaving_mode_grid_desc()
			: m.peak_shaving_mode_exports_desc()
	);
	const readOnly = $derived(!isAdmin || saving);
	const enableDisabled = $derived(readOnly || enableLocked);

	function setEnabled(v: boolean) {
		if (draft) draft.peakShaving.enabled = v;
	}

	function setMode(v: string) {
		if (draft) draft.peakShaving.mode = v as PeakShavingMode;
	}

	/** Every numeric field as a number, or null when one of them isn't one. */
	function parsedNums(): Record<NumKey, number> | null {
		const parsed = {} as Record<NumKey, number>;
		for (const f of Object.keys(nums) as NumKey[]) {
			const value = parseNum(nums[f]);
			if (value === null) return null;
			parsed[f] = value;
		}
		return parsed;
	}

	/** Server-supplied reason for a rejected save, or a generic fallback. */
	function errorDetail(value: unknown): string {
		return (value as { error?: string } | null)?.error ?? m.automations_toast_error();
	}

	async function submit(parsed: Record<NumKey, number>) {
		if (!draft) return;
		const { data, error } = await api.api.settings.automations.put({
			...draft,
			peakShaving: { ...draft.peakShaving, ...parsed }
		});
		if (error) {
			toast.error(errorDetail(error.value));
			return;
		}
		draft = data as AutomationConfig;
		toast.success(m.automations_toast_saved());
	}

	async function save() {
		const parsed = parsedNums();
		if (!parsed) {
			toast.error(m.automations_toast_invalid());
			return;
		}
		saving = true;
		await submit(parsed);
		saving = false;
	}
</script>

<SaveBar {isAdmin} {saving} disabled={!draft} onsave={save} />

<SettingsSection title={m.peak_shaving_title()}>
	{#if !draft}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else if !draft.enabled}
		<Alert.Root>
			<Alert.Title>{m.automations_master_off_title()}</Alert.Title>
			<Alert.Description>
				{m.automations_master_off_desc()}
				<a class="underline underline-offset-2" href={resolve('/settings/automations')}>
					{m.automations_master_off_link()}
				</a>
			</Alert.Description>
		</Alert.Root>
	{:else}
		<p class="text-sm text-muted-foreground">{m.peak_shaving_desc()}</p>

		<div class="flex items-center justify-between gap-4">
			<Label for="peak-shaving-enabled">{m.peak_shaving_enable()}</Label>
			<Switch
				id="peak-shaving-enabled"
				checked={draft.peakShaving.enabled}
				disabled={enableDisabled}
				onCheckedChange={setEnabled}
			/>
		</div>

		<BlockerAlert {blockers} />

		<Separator />

		<div class="flex flex-col gap-1.5">
			<Label>{m.peak_shaving_mode()}</Label>
			<OptionSelect
				value={draft.peakShaving.mode}
				items={[
					{ value: 'maximize-exports', label: m.peak_shaving_mode_exports() },
					{ value: 'grid-friendly', label: m.peak_shaving_mode_grid() }
				]}
				onchange={setMode}
			/>
			<p class="text-sm text-muted-foreground">{modeDesc}</p>
		</div>

		<div class="grid gap-3 sm:grid-cols-2">
			{#each numFields as field (field.key)}
				<div class="flex flex-col gap-1.5">
					<Label for="ps-{field.key}">{field.label}</Label>
					<Input
						id="ps-{field.key}"
						bind:value={nums[field.key]}
						disabled={readOnly}
						inputmode="decimal"
						placeholder={field.placeholder}
					/>
					<p class="text-xs text-muted-foreground">{field.desc}</p>
				</div>
			{/each}
		</div>
	{/if}
</SettingsSection>
