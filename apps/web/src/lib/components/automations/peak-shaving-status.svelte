<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Alert from '$lib/components/ui/alert';
	import SettingsSection from '$lib/components/settings/settings-section.svelte';
	import MetricGrid, { type MetricRow } from './metric-grid.svelte';
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { PeakShavingRunState, PeakShavingStatus } from '$lib/automations';

	let { status }: { status: PeakShavingStatus | null } = $props();

	// The 1 Hz live sample beats the 5 s status poll for the current PV reading.
	const pvKey = $derived(inverter.byRole('pv.total.power')?.key);
	const livePvW = $derived(pvKey ? inverter.value(pvKey) : undefined);

	type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

	const STATE_LABEL: Record<PeakShavingRunState, () => string> = {
		active: m.automation_state_active,
		idle: m.automation_state_idle,
		blocked: m.automation_state_blocked,
		stale: m.automation_state_stale,
		disabled: m.automation_state_disabled
	};
	const STATE_VARIANT: Record<PeakShavingRunState, BadgeVariant> = {
		active: 'default',
		idle: 'secondary',
		blocked: 'destructive',
		stale: 'destructive',
		disabled: 'outline'
	};
	const runState = $derived<PeakShavingRunState>(status?.state ?? 'disabled');

	const fmtW = (w: number | null | undefined) =>
		w == null ? '—' : w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
	const fmtA = (a: number | null | undefined) => (a == null ? '—' : `${a} A`);
	const fmtKwh = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} kWh`);
	const fmtTime = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleTimeString() : '—';

	// Alerts and metrics are derived lists so the template stays two loops
	// instead of a branch per banner and per reading.
	const alerts = $derived.by(() => {
		const s = status;
		if (!s) return [];
		return [
			{
				when: s.externalOverride,
				text: m.peak_shaving_override_warning(),
				variant: 'destructive' as const
			},
			{
				when: s.enabled && !s.forecastAvailable,
				text: m.peak_shaving_no_forecast(),
				variant: 'default' as const
			},
			{ when: s.lastError != null, text: s.lastError ?? '', variant: 'destructive' as const }
		].filter((a) => a.when);
	});

	const rows = $derived.by<MetricRow[]>(() => {
		const s = status;
		if (!s) return [];
		return [
			{ label: m.peak_shaving_status_pv(), value: fmtW(livePvW) },
			{ label: m.peak_shaving_status_threshold(), value: fmtW(s.thresholdW) },
			{ label: m.peak_shaving_status_target(), value: fmtA(s.targetA) },
			{ label: m.peak_shaving_status_live(), value: fmtA(s.liveA) },
			{ label: m.peak_shaving_status_headroom(), value: fmtKwh(s.headroomKwh) },
			{ label: m.peak_shaving_status_surplus(), value: fmtKwh(s.remainingAboveLimitKwh) },
			// EV readings only exist while EVCC reports a loadpoint.
			...(s.evChargeW == null
				? []
				: [
						{ label: m.peak_shaving_status_ev_power(), value: fmtW(s.evChargeW) },
						{ label: m.peak_shaving_status_ev_demand(), value: fmtKwh(s.evDemandKwh) }
					]),
			{ label: m.peak_shaving_status_last_write(), value: fmtTime(s.lastWriteAt) },
			{ label: m.peak_shaving_status_last_tick(), value: fmtTime(s.lastTickAt) }
		];
	});
</script>

<SettingsSection title={m.automations_status_title()}>
	{#snippet actions()}
		<Badge variant={STATE_VARIANT[runState]}>{STATE_LABEL[runState]()}</Badge>
	{/snippet}

	{#if !status}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else}
		{#each alerts as alert (alert.text)}
			<Alert.Root variant={alert.variant}>
				<Alert.Description>{alert.text}</Alert.Description>
			</Alert.Root>
		{/each}

		<MetricGrid {rows} />

		{#if status.restorePending}
			<p class="text-xs text-muted-foreground">{m.peak_shaving_status_restore()}</p>
		{/if}
	{/if}
</SettingsSection>
