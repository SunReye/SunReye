<script lang="ts">
	import { slide } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { Badge } from '$lib/components/ui/badge';
	import * as Alert from '$lib/components/ui/alert';
	import SettingsSection from '$lib/components/settings/settings-section.svelte';
	import MetricGrid, { type MetricRow } from './metric-grid.svelte';
	import StatTiles from './stat-tiles.svelte';
	import { STATE_LABEL, STATE_VARIANT } from './run-state';
	import StatusBadges from './status-badges.svelte';
	import { evcc } from '$lib/evcc/store.svelte';
	import { formatReading, type Reading } from '$lib/live/plant';
	import { livePlant } from '$lib/live/plant.svelte';
	import { headroomReading } from './headroom';
	import * as m from '$lib/paraglide/messages';
	import type { PeakShavingRunState, PeakShavingStatus } from '$lib/automations';

	let { status }: { status: PeakShavingStatus | null } = $props();

	// Every "now" reading below comes from the feed that owns it (see
	// `$lib/live/ownership.ts`), and from nowhere else. The panel used to fall
	// back to `status` — the engine's decision, taken at `controlIntervalS` —
	// whenever a profile mapped no register for a quantity, and then animated
	// that 30 s number across the 1 Hz metrics cadence. It finished gliding in a
	// second and sat dead for twenty-nine, which reads as live and is not.
	// Where the owner is silent, the tile now says so.
	$effect(() => livePlant.lease());
	const pv = $derived(livePlant.read('pv.total.power'));
	const load = $derived(livePlant.read('load.power'));
	const registerA = $derived(livePlant.read('setting.battery.max_charge_current'));
	const sellLimit = $derived(livePlant.read('setting.solar_sell.max_power'));
	const headroom = $derived(headroomReading(status?.usableKwh, livePlant.read('battery.soc')));
	const evCharge = $derived(livePlant.read('evcc.charge.power'));
	// EVCC's rows exist only while the engine has a loadpoint to report, and its
	// cadence estimate only advances while the store holds a lease. The lease
	// hangs off a memoized boolean, NOT off `status` itself — the status object
	// is replaced on every stream frame, and an effect keyed on it would give the
	// EVCC topic back and re-subscribe it each time.
	const showEv = $derived(status?.evChargeW != null);
	$effect(() => {
		if (!showEv) return;
		return evcc.lease();
	});

	const runState = $derived<PeakShavingRunState>(status?.state ?? 'disabled');
	const slideMs = $derived(prefersReducedMotion.current ? 0 : 160);

	const fmtW = (w: number | null | undefined) =>
		w == null ? '—' : w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
	const fmtA = (a: number | null | undefined) => (a == null ? '—' : `${a} A`);
	const fmtKwh = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)} kWh`);
	const fmtTime = (iso: string | null | undefined) =>
		iso ? new Date(iso).toLocaleTimeString() : '—';
	// A canonical reading as text: the number, an em dash when its owner has
	// never reported one, or the number plus a marker once it has stopped being
	// refreshed. A missing number is honest; a stale one wearing a live
	// animation is not.
	const show = (reading: Reading, format: (value: number) => string) =>
		formatReading(reading, format, m.live_reading_stale());

	// Alerts and metrics are derived lists so the template stays two loops
	// instead of a branch per banner and per reading.
	const regime = $derived(status?.priceRegime ?? 'none');

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
			{
				// The honest case: withholding charge cannot empty the pack in time, so
				// say so rather than let the plan look like it is working.
				when: s.priceRegime === 'spend-down',
				text: m.peak_shaving_spend_down_hint(),
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
				sub: `${m.peak_shaving_status_live()}: ${show(registerA, fmtA)}`
			},
			{ label: m.peak_shaving_status_threshold(), value: fmtW(s.thresholdW), sub: null },
			{ label: m.peak_shaving_status_headroom(), value: show(headroom, fmtKwh), sub: null }
		];
	});

	const fmtWindow = (from: number | null, to: number | null) =>
		from == null || to == null
			? '—'
			: `${new Date(from).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(to).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

	/**
	 * Price readings, only once a window is actually in play — on an ordinary day
	 * the panel looks exactly as it did before this feature existed.
	 */
	function priceRows(s: PeakShavingStatus): MetricRow[] {
		if (s.priceRegime === 'none') return [];
		const envelope = s.socEnvelopePct;
		return [
			{ label: m.peak_shaving_status_window(), value: fmtWindow(s.windowStartsAt, s.windowEndsAt) },
			{
				label: m.peak_shaving_status_envelope(),
				value: envelope == null ? '—' : `${Math.round(envelope)} %`
			},
			{ label: m.peak_shaving_status_soakable(), value: fmtKwh(s.soakableKwh) },
			{ label: m.peak_shaving_status_unavoidable(), value: fmtKwh(s.unavoidableZeroValueKwh) }
		];
	}

	const rows = $derived.by<MetricRow[]>(() => {
		const s = status;
		if (!s) return [];
		return [
			{ label: m.peak_shaving_status_load(), value: show(load, fmtW) },
			{ label: m.peak_shaving_status_surplus(), value: fmtKwh(s.remainingAboveLimitKwh) },
			// The feed-in ceiling register is only steered in grid-friendly; elsewhere
			// the plant's own limit stands and there is nothing of ours to report.
			...(s.mode === 'grid-friendly'
				? [
						{
							label: m.peak_shaving_status_sell_limit(),
							value: `${fmtW(s.sellLimitW)} / ${show(sellLimit, fmtW)}`
						}
					]
				: []),
			// EV readings only exist while EVCC reports a loadpoint.
			...(s.evChargeW == null
				? []
				: [
						{ label: m.peak_shaving_status_ev_power(), value: show(evCharge, fmtW) },
						{ label: m.peak_shaving_status_ev_demand(), value: fmtKwh(s.evDemandKwh) }
					]),
			...priceRows(s),
			{ label: m.peak_shaving_status_last_write(), value: fmtTime(s.lastWriteAt) },
			{ label: m.peak_shaving_status_last_tick(), value: fmtTime(s.lastTickAt) }
		];
	});
</script>

<SettingsSection title={m.automations_status_title()}>
	{#snippet actions()}
		<StatusBadges {runState} {regime} />
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

		<StatTiles {pv} {tiles} />

		<MetricGrid {rows} />

		{#if status.restorePending}
			<p class="text-xs text-muted-foreground">{m.peak_shaving_status_restore()}</p>
		{/if}
	{/if}
</SettingsSection>
