<script lang="ts">
	// One plan tab's body: hint, summary and the two charts — or the empty text
	// when the day has neither a projection nor measured rows to show.
	import PlanSummary from './plan-summary.svelte';
	import ChartFullscreen from '$lib/components/layout/chart-fullscreen.svelte';
	import PlanPowerChart from './plan-power-chart.svelte';
	import SocChart from './soc-chart.svelte';
	import type { PlanRow, SocRow } from './plan-series';
	import type { PeakShavingPlan } from '$lib/automations';
	import * as m from '$lib/paraglide/messages';

	let {
		plan,
		hint,
		emptyText,
		powerRows,
		socRows
	}: {
		plan: PeakShavingPlan | null;
		hint: string;
		emptyText: string;
		powerRows: PlanRow[];
		socRows: SocRow[];
	} = $props();

	const planWithSlots = $derived(plan && plan.slots.length > 0 ? plan : null);
	const hasContent = $derived(planWithSlots !== null || powerRows.length > 0);
</script>

{#if !hasContent}
	<p class="text-sm text-muted-foreground">{emptyText}</p>
{:else}
	<p class="text-sm text-muted-foreground">{hint}</p>

	{#if planWithSlots}
		<PlanSummary plan={planWithSlots} />
	{/if}

	<div class="flex flex-col gap-2">
		<p class="text-xs font-medium text-muted-foreground">{m.automations_plan_power()}</p>
		<ChartFullscreen title={m.automations_plan_power()}>
			<PlanPowerChart rows={powerRows} />
		</ChartFullscreen>
	</div>

	{#if socRows.length > 0}
		<div class="flex flex-col gap-2">
			<p class="text-xs font-medium text-muted-foreground">{m.automations_plan_soc()}</p>
			<ChartFullscreen title={m.automations_plan_soc()}>
				<SocChart rows={socRows} />
			</ChartFullscreen>
		</div>
	{/if}
{/if}
