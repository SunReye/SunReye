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
	import { evcc } from '$lib/evcc/store.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { PeakShavingRunState, PeakShavingStatus } from '$lib/automations';

	let { status }: { status: PeakShavingStatus | null } = $props();

	// Everything the plant meters beats the streamed tick: PV, house load, the
	// two registers and SOC all update at the 1 Hz live sample; only the
	// decisions themselves (target, threshold, surplus) move per control tick.
	const liveRole = (role: Parameters<typeof inverter.byRole>[0]): number | undefined => {
		const key = inverter.byRole(role)?.key;
		return key ? inverter.value(key) : undefined;
	};
	const livePvW = $derived(liveRole('pv.total.power'));
	const liveLoadW = $derived(liveRole('load.power') ?? status?.loadW);
	const liveRegisterA = $derived(
		liveRole('setting.battery.max_charge_current') ?? status?.liveA
	);
	const liveSellLimitW = $derived(
		liveRole('setting.solar_sell.max_power') ?? status?.liveSellLimitW
	);
	// Headroom re-derived from the live SOC once a tick has told us the pack size.
	const liveSocPct = $derived(liveRole('battery.soc'));
	const liveHeadroomKwh = $derived(
		status?.usableKwh != null && liveSocPct != null
			? (status.usableKwh * (100 - Math.min(100, Math.max(0, liveSocPct)))) / 100
			: status?.headroomKwh
	);
	// EV draw at the EVCC feed's cadence while its rows are shown. The lease
	// hangs off a memoized boolean, NOT off `status` itself — the status object
	// is replaced on every stream frame, and an effect keyed on it would tear
	// down and reopen the EVCC socket each time.
	const showEv = $derived(status?.evChargeW != null);
	$effect(() => {
		if (!showEv) return;
		return evcc.connect();
	});
	const liveEvChargeW = $derived(evcc.active ? evcc.chargePower : status?.evChargeW);

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
				sub: `${m.peak_shaving_status_live()}: ${fmtA(liveRegisterA)}`
			},
			{ label: m.peak_shaving_status_threshold(), value: fmtW(s.thresholdW), sub: null },
			{ label: m.peak_shaving_status_headroom(), value: fmtKwh(liveHeadroomKwh), sub: null }
		];
	});

	const rows = $derived.by<MetricRow[]>(() => {
		const s = status;
		if (!s) return [];
		return [
			{ label: m.peak_shaving_status_load(), value: fmtW(liveLoadW) },
			{ label: m.peak_shaving_status_surplus(), value: fmtKwh(s.remainingAboveLimitKwh) },
			// The feed-in ceiling register is only steered in grid-friendly; elsewhere
			// the plant's own limit stands and there is nothing of ours to report.
			...(s.mode === 'grid-friendly'
				? [
						{
							label: m.peak_shaving_status_sell_limit(),
							value: `${fmtW(s.sellLimitW)} / ${fmtW(liveSellLimitW)}`
						}
					]
				: []),
			// EV readings only exist while EVCC reports a loadpoint.
			...(s.evChargeW == null
				? []
				: [
						{ label: m.peak_shaving_status_ev_power(), value: fmtW(liveEvChargeW) },
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
