<script lang="ts">
	// Decision history section: reads the optimizer's STORED series and plots it
	// as the power plane plus the charge ceiling. Two charts on purpose — kW and
	// A are different measures, and one plot may only carry one scale.
	//
	// It used to plot a ring the server held in memory and pushed over the socket:
	// empty for the first half-minute after every restart, twenty-four hours deep
	// at most, and gone on every deploy. The optimizer is a device now, so this
	// asks `/api/history/rollup` for `optimizer.*` under the `optimizer` slug,
	// exactly as the inverter card asks for PV power.
	import Section from '$lib/components/layout/section.svelte';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import ChartFullscreen from '$lib/components/layout/chart-fullscreen.svelte';
	import DecisionPowerChart from './decision-power-chart.svelte';
	import DecisionCeilingChart from './decision-ceiling-chart.svelte';
	import { DECISION_WINDOWS, hasLoad, hasRegister, toDecisionRows } from './decision-series';
	import type { DecisionRow, DecisionWindow } from './decision-series';
	import { fetchDecisionSeries } from './decision-fetch';
	import * as m from '$lib/paraglide/messages';

	// `lastTickAt` is the server's own stamp for the newest decision — the cue to
	// re-read, and nothing more. Passing the stamp rather than a signal means a
	// reconnect that replays the same frame costs no round trip.
	let { loaded, lastTickAt }: { loaded: boolean; lastTickAt: string | null } = $props();

	let range = $state<DecisionWindow>('6h');
	let rows = $state<DecisionRow[]>([]);
	let fetched = $state(false);

	const WINDOW_OPTIONS = [
		{ id: '1h' as const, label: '1 h' },
		{ id: '6h' as const, label: '6 h' },
		{ id: '24h' as const, label: '24 h' }
	];

	// What the rows on screen were fetched for, and which read is the current
	// one. PLAIN locals, deliberately: they are the effect's own memory and
	// nothing renders from them, so making them reactive would only feed the
	// effect its own writes.
	let fetchedFor = '';
	let generation = 0;

	// Re-read on a window change and on every new decision — and on NOTHING else.
	//
	// The gate is the point. The store replaces its whole `$state` object per
	// frame, so an effect reading anything off it re-runs on every frame the
	// socket delivers, including the snapshot a reconnect replays. Ungated that
	// is five requests per frame, forever, for numbers that did not move. What
	// identifies a fetch is the window plus the engine's own tick stamp, so that
	// is what is remembered. Proved in `e2e/optimizer-history.spec.ts`, because
	// "how many requests did that frame cost" only exists in a running document.
	//
	// A stale answer is dropped by the GENERATION, never by a teardown: an effect
	// re-runs on every frame whether or not this gate lets it fetch, so cancelling
	// from the cleanup would abort the in-flight read on the very next frame and
	// start nothing in its place — a section stuck on "Loading…" forever.
	$effect(() => {
		const windowMs = DECISION_WINDOWS[range];
		const key = `${range}:${lastTickAt ?? ''}`;
		if (key === fetchedFor) return;
		fetchedFor = key;
		const mine = ++generation;
		// Newest-anchored on the CLIENT clock, so the right edge tracks now even
		// while the engine is blocked and stamping nothing.
		const to = new Date();
		void fetchDecisionSeries(new Date(to.getTime() - windowMs), to).then((series) => {
			if (mine !== generation) return;
			rows = toDecisionRows(series);
			fetched = true;
		});
	});

	const showLoad = $derived(hasLoad(rows));
	const showRegister = $derived(hasRegister(rows));

	// Both decisions live here rather than as branches in the markup: a template
	// is the one place this repo cannot unit-test, so it holds none it does not
	// have to. `ready` is the socket's first frame AND the first history answer —
	// the section has two sources now, and either one outstanding is "loading".
	const ready = $derived(loaded && fetched);
	const hint = $derived(
		rows.at(-1)?.shadow === true
			? m.automations_charts_shadow_hint()
			: m.automations_charts_live_hint()
	);
</script>

<Section title={m.automations_charts_title()}>
	{#snippet actions()}
		<RangeSwitcher options={WINDOW_OPTIONS} bind:value={range} label={m.range_select_window_aria()} />
	{/snippet}

	{#if !ready}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else if rows.length === 0}
		<p class="text-sm text-muted-foreground">{m.automations_charts_empty()}</p>
	{:else}
		<p class="text-sm text-muted-foreground">{hint}</p>

		<!-- One control per plot, not one for the card: this section holds two
		     charts plus three paragraphs, and expanding all of it split a
		     landscape screen five ways and left each plot 59px tall. -->
		<div class="flex flex-col gap-2">
			<p class="text-xs font-medium text-muted-foreground">{m.automations_charts_power()}</p>
			<ChartFullscreen title={m.automations_charts_power()}>
				<DecisionPowerChart {rows} {showLoad} />
			</ChartFullscreen>
		</div>

		<div class="flex flex-col gap-2">
			<p class="text-xs font-medium text-muted-foreground">{m.automations_charts_ceiling()}</p>
			<ChartFullscreen title={m.automations_charts_ceiling()}>
				<DecisionCeilingChart {rows} {showRegister} />
			</ChartFullscreen>
		</div>

		<p class="text-xs text-muted-foreground">{m.automations_charts_retention()}</p>
	{/if}
</Section>
