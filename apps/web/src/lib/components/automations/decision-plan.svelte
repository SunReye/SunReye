<script lang="ts">
	// "Rest of today" section with three views. **Live**: the projection from
	// this moment on, streamed with every engine tick. **Today**: the measured
	// day so far joined with that projection — where the PV actually went, then
	// where it is planned to go. **Tomorrow**: the whole next day replayed over
	// its forecast. Served even while the automation is off, so this doubles as
	// a preview before enabling.
	//
	// The measured half is the plant's OWN history, read from the minute rollups
	// through the one series reader every chart in the app uses. It used to fall
	// back to the engine's in-memory decision ring, which cleared on every
	// restart and only ever held the ticks the automation decided — so the
	// fallback drew a shorter, different day than the chart above it.
	import { fade } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import Section from '$lib/components/layout/section.svelte';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import PlanDayView from './plan-day-view.svelte';
	import { joinDayRows, toPlanRows, toSocRows } from './plan-series';
	import { fetchMeasuredDay, type MeasuredDay } from '$lib/history/plant-day';
	import * as m from '$lib/paraglide/messages';
	import type { PeakShavingPlans } from '$lib/automations';

	let { plans, loaded }: { plans: PeakShavingPlans | null; loaded: boolean } = $props();

	type PlanView = 'live' | 'today' | 'tomorrow';
	let view = $state<PlanView>('live');

	const VIEW_OPTIONS = [
		{ id: 'live' as const, label: m.automations_plan_tab_live() },
		{ id: 'today' as const, label: m.automations_plan_tab_today() },
		{ id: 'tomorrow' as const, label: m.automations_plan_tab_tomorrow() }
	];

	// Fetched while a view that shows measured history is open, refreshed each
	// minute — which is also the bucket width, so a faster poll would re-read the
	// same numbers.
	let measuredDay = $state<MeasuredDay | null>(null);
	$effect(() => {
		if (view === 'tomorrow') return;
		let stop = false;
		const load = async () => {
			const day = await fetchMeasuredDay();
			if (!stop && day) measuredDay = day;
		};
		void load();
		const id = setInterval(() => void load(), 60_000);
		return () => {
			stop = true;
			clearInterval(id);
		};
	});

	// Tomorrow reads its own projection; live and today share the rest-of-today
	// one (today merely prepends the measured past).
	const dayPlan = $derived(view === 'tomorrow' ? (plans?.tomorrow ?? null) : (plans?.today ?? null));
	const planRows = $derived(toPlanRows(dayPlan?.slots ?? []));
	const measuredRows = $derived(view === 'today' ? (measuredDay?.power ?? []) : []);
	const powerRows = $derived(view === 'today' ? joinDayRows(measuredRows, planRows) : planRows);

	// The SOC track keeps its measured half on live/today; tomorrow is pure plan.
	const socHistory = $derived(view === 'tomorrow' ? [] : (measuredDay?.soc ?? []));
	const socRows = $derived(toSocRows(socHistory, dayPlan));

	const hint = $derived(
		view === 'tomorrow'
			? m.automations_plan_tomorrow_hint()
			: view === 'today'
				? m.automations_plan_today_hint()
				: m.automations_plan_hint()
	);
	const emptyText = $derived(
		view === 'tomorrow' ? m.automations_plan_tomorrow_empty() : m.automations_plan_empty()
	);
	const fadeMs = $derived(prefersReducedMotion.current ? 0 : 150);
</script>

<Section title={m.automations_plan_title()}>
	{#snippet actions()}
		<RangeSwitcher options={VIEW_OPTIONS} bind:value={view} label={m.range_select_view_aria()} />
	{/snippet}

	{#if !loaded}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else}
		{#key view}
			<div class="flex flex-col gap-4" in:fade={{ duration: fadeMs }}>
				<PlanDayView plan={dayPlan} {hint} {emptyText} {powerRows} {socRows} />
			</div>
		{/key}
	{/if}
</Section>
