<script lang="ts">
	// The plan's headline answers as text. "Charging starts 11:15, full by 15:40"
	// is a fact, not a shape — reading it off a chart would be work.
	import MetricGrid, { type MetricRow } from './metric-grid.svelte';
	import { display } from '$lib/display.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { PeakShavingPlan } from '$lib/automations';

	let { plan }: { plan: PeakShavingPlan } = $props();

	const at = (ms: number | null) => (ms === null ? m.automations_plan_never() : display.time(new Date(ms)));
	const kwh = (v: number) => `${v.toFixed(1)} kWh`;

	const rows = $derived<MetricRow[]>([
		{ label: m.automations_plan_charge_start(), value: at(plan.chargeStartsAt) },
		{ label: m.automations_plan_full_at(), value: at(plan.fullAt) },
		{ label: m.automations_plan_end_soc(), value: `${Math.round(plan.endSocPct)} %` },
		{ label: m.automations_plan_stored(), value: kwh(plan.storedKwh) },
		{ label: m.automations_plan_exported(), value: kwh(plan.exportedKwh) },
		{ label: m.automations_plan_curtailed(), value: kwh(plan.curtailedKwh) }
	]);
</script>

<MetricGrid {rows} />
