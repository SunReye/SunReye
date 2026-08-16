<script lang="ts">
	// Decision history section: polls the engine's in-memory log and plots it as
	// the power plane plus the charge ceiling. Two charts on purpose — kW and A
	// are different measures, and one plot may only carry one scale.
	import Section from '$lib/components/layout/section.svelte';
	import RangeSwitcher from '$lib/components/inverter/range-switcher.svelte';
	import ChartFullscreen from '$lib/components/layout/chart-fullscreen.svelte';
	import DecisionPowerChart from './decision-power-chart.svelte';
	import DecisionCeilingChart from './decision-ceiling-chart.svelte';
	import { DECISION_WINDOWS, hasLoad, hasRegister, toDecisionRows } from './decision-series';
	import type { DecisionWindow } from './decision-series';
	import * as m from '$lib/paraglide/messages';
	import type { DecisionPoint } from '$lib/automations';

	// The log is fetched once by the page and shared with the plan section.
	let { points, loaded }: { points: DecisionPoint[]; loaded: boolean } = $props();

	let range = $state<DecisionWindow>('6h');

	const WINDOW_OPTIONS = [
		{ id: '1h' as const, label: '1 h' },
		{ id: '6h' as const, label: '6 h' },
		{ id: '24h' as const, label: '24 h' }
	];

	const rows = $derived(toDecisionRows(points, DECISION_WINDOWS[range]));
	const showLoad = $derived(hasLoad(points));
	const showRegister = $derived(hasRegister(points));
	const shadowing = $derived(points.at(-1)?.shadow === true);
</script>

<Section title={m.automations_charts_title()}>
	{#snippet actions()}
		<RangeSwitcher options={WINDOW_OPTIONS} bind:value={range} />
	{/snippet}

	{#if !loaded}
		<p class="text-sm text-muted-foreground">{m.app_loading()}</p>
	{:else if rows.length === 0}
		<p class="text-sm text-muted-foreground">{m.automations_charts_empty()}</p>
	{:else}
		<p class="text-sm text-muted-foreground">
			{shadowing ? m.automations_charts_shadow_hint() : m.automations_charts_live_hint()}
		</p>

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
