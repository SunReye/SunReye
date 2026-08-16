<script lang="ts">
	// "Add this metric to a chart", on every card on /history.
	//
	// The editor already existed and could do all of this — open it, type a
	// name, search the catalogue of 100+ metrics, find the one you were just
	// looking at. This is the short path: the metric is the one on this card,
	// and the only question left is which chart it joins.
	//
	// Which charts hold it and what a pick does to their metric list is decided
	// in $lib/inverter/chart-membership (plain TS, tested); what is here is the
	// menu and the in-flight state.
	import Plus from 'phosphor-svelte/lib/Plus';
	import MetricChartMenuRow from './metric-chart-menu-row.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as m from '$lib/paraglide/messages';
	import { customCharts } from '$lib/inverter/custom-charts.svelte';
	import { membership, plannedUpdate } from '$lib/inverter/chart-membership';
	import { TAP } from '$lib/layout/tokens';

	let { metricKey }: { metricKey: string } = $props();

	let busy = $state(false);

	const items = $derived(membership(customCharts.charts, metricKey));

	// What a pick should send — and the three reasons it should send nothing —
	// is decided in `plannedUpdate`, where it is tested.
	async function toggle(id: string) {
		if (busy) return;
		const planned = plannedUpdate(customCharts.charts, id, metricKey);
		if (!planned) return;
		busy = true;
		await customCharts.update(planned.id, planned.input);
		busy = false;
	}

	const startNew = () => customCharts.seedEditor([metricKey]);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger
		class="{TAP} text-muted-foreground transition-colors hover:text-foreground"
		title={m.chart_add_to_chart()}
		disabled={busy}
	>
		<Plus class="size-4" />
		<span class="sr-only">{m.chart_add_to_chart()}</span>
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="max-w-64">
		<DropdownMenu.Label>{m.chart_add_to_chart()}</DropdownMenu.Label>
		{#each items as item (item.id)}
			<MetricChartMenuRow {item} {busy} onPick={() => toggle(item.id)} />
		{/each}
		{#if items.length > 0}
			<DropdownMenu.Separator />
		{/if}
		<DropdownMenu.Item onSelect={startNew}>
			<Plus class="size-4 shrink-0" />
			<span class="truncate">{m.chart_add_new_with_metric()}</span>
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
