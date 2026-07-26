<script lang="ts">
	import Plus from 'phosphor-svelte/lib/Plus';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import ChartGrid from './_shared/chart-grid.svelte';
	import ChartEmptyState from './_shared/chart-empty-state.svelte';
	import ChartAdminDialogs from './_shared/chart-admin-dialogs.svelte';
	import { useAppSession } from '$lib/session';
	import { type CustomChart, customCharts } from '$lib/inverter/custom-charts.svelte';
	import type { HistoryRange } from '$lib/inverter/ranges';

	let { range }: { range: HistoryRange } = $props();

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	// Load saved charts once (idempotent).
	customCharts.start();

	let editorOpen = $state(false);
	let editing = $state<CustomChart | null>(null);
	let pendingDelete = $state<CustomChart | null>(null);

	function openCreate() {
		editing = null;
		editorOpen = true;
	}
	function openEdit(chart: CustomChart) {
		editing = chart;
		editorOpen = true;
	}
	const requestDelete = (chart: CustomChart) => (pendingDelete = chart);

	const charts = $derived(customCharts.charts);
	// Hide the whole section for non-admins when there's nothing saved yet.
	const show = $derived(isAdmin || charts.length > 0);
	const isEmpty = $derived(charts.length === 0);
</script>

{#if show}
	<section class="flex flex-col gap-4">
		<div class="flex items-center justify-between gap-3 border-b border-border py-2">
			<h2 class="text-sm font-medium">{m.chart_custom_charts()}</h2>
			{#if isAdmin}
				<Button size="sm" variant="outline" onclick={openCreate}>
					<Plus class="size-4" />
					{m.chart_new_chart()}
				</Button>
			{/if}
		</div>

		{#if isEmpty}
			<ChartEmptyState {isAdmin} onCreate={openCreate} />
		{:else}
			<ChartGrid {charts} {range} {isAdmin} onEdit={openEdit} onDelete={requestDelete} />
		{/if}
	</section>

	<ChartAdminDialogs {isAdmin} bind:editorOpen {editing} bind:pendingDelete />
{/if}
