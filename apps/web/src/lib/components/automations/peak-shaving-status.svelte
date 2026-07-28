<script lang="ts">
	import { slide } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { Badge } from '$lib/components/ui/badge';
	import * as Alert from '$lib/components/ui/alert';
	import SettingsSection from '$lib/components/settings/settings-section.svelte';
	import MetricGrid, { type MetricRow } from './metric-grid.svelte';
	import StatTiles from './stat-tiles.svelte';
	import { STATE_LABEL, STATE_VARIANT } from './run-state';
	import { inverter } from '$lib/inverter/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { PeakShavingRunState, PeakShavingStatus } from '$lib/automations';

	let { status }: { status: PeakShavingStatus | null } = $props();

	// The 1 Hz live sample beats the streamed tick for the current PV reading.
	const pvKey = $derived(inverter.byRole('pv.total.power')?.key);
	const livePvW = $derived(pvKey ? inverter.value(pvKey) : undefined);

	const runState = $derived<PeakShavingRunState>(status?.state ?? 'disabled');
	const slideMs = $derived(prefersReducedMotion.current ? 0 : 160);

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
				when: s.state === 'simulating',
				text: m.peak_shaving_simulating_hint(),
				variant: 'default' as const
			},
			{
				when: s.externalOverride,
				text: m.peak_shaving_override_warning(),
				variant: 'destructive' as const
			},
			{
				when: s.ineffective,
				text: m.peak_shaving_ineffective_warning(),
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

	// The four headline readings ride as stat tiles; everything else stays in
	// the label/value grid below.
	const tiles = $derived.by(() => {
		const s = status;
		if (!s) return [];
		return [
			{
				label: m.peak_shaving_status_target(),
				value: fmtA(s.targetA),
				sub: `${m.peak_shaving_status_live()}: ${fmtA(s.liveA)}`
			},
			{ label: m.peak_shaving_status_threshold(), value: fmtW(s.thresholdW), sub: null },
			{ label: m.peak_shaving_status_headroom(), value: fmtKwh(s.headroomKwh), sub: null }
		];
	});

	const rows = $derived.by<MetricRow[]>(() => {
		const s = status;
		if (!s) return [];
		return [
			{ label: m.peak_shaving_status_load(), value: fmtW(s.loadW) },
			{ label: m.peak_shaving_status_surplus(), value: fmtKwh(s.remainingAboveLimitKwh) },
			// The feed-in ceiling register is only steered in grid-friendly; elsewhere
			// the plant's own limit stands and there is nothing of ours to report.
			...(s.mode === 'grid-friendly'
				? [
						{
							label: m.peak_shaving_status_sell_limit(),
							value: `${fmtW(s.sellLimitW)} / ${fmtW(s.liveSellLimitW)}`
						}
					]
				: []),
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
			<div transition:slide={{ duration: slideMs }}>
				<Alert.Root variant={alert.variant}>
					<Alert.Description>{alert.text}</Alert.Description>
				</Alert.Root>
			</div>
		{/each}

		<StatTiles {livePvW} {tiles} />

		<MetricGrid {rows} />

		{#if status.restorePending}
			<p class="text-xs text-muted-foreground">{m.peak_shaving_status_restore()}</p>
		{/if}
	{/if}
</SettingsSection>
