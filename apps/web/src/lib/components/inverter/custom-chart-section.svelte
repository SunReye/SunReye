<script lang="ts">
	import Plus from 'phosphor-svelte/lib/Plus';
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import * as m from '$lib/paraglide/messages';
	import ChartGrid from './_shared/chart-grid.svelte';
	import ChartEmptyState from './_shared/chart-empty-state.svelte';
	import ChartAdminDialogs from './_shared/chart-admin-dialogs.svelte';
	import { useAppSession } from '$lib/session';
	import { customCharts } from '$lib/inverter/custom-charts.svelte';
	import type { CustomChart } from '$lib/inverter/custom-chart';
	import type { HistoryRange } from '$lib/inverter/ranges';

	let {
		range,
		onZoom,
		onResetZoom
	}: {
		range: HistoryRange;
		/** Forwarded to every saved chart: a drag on one moves the whole page. */
		onZoom?: (next: HistoryRange) => void;
		onResetZoom?: () => void;
	} = $props();

	const session = useAppSession();
	const isAdmin = $derived($session.data?.user.role === 'admin');

	// Load saved charts once (idempotent).
	customCharts.start();

	let editorOpen = $state(false);
	let editing = $state<CustomChart | null>(null);
	let pendingDelete = $state<CustomChart | null>(null);
	let seed = $state<string[]>([]);

	// A card on /history asked for a new chart carrying its metric. The editor
	// is mounted once, here, so the request travels through the store rather
	// than through six components of prop plumbing.
	$effect(() => {
		const requested = customCharts.editorSeed;
		if (!requested) return;
		customCharts.editorSeed = null;
		seed = requested;
		editing = null;
		editorOpen = true;
	});

	function openCreate() {
		editing = null;
		seed = [];
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
	<!-- This drew a bottom-ruled, sentence-case header — a third section idiom on
	     a page that already showed two. The card is the shared one now, so the
	     "New chart" button becomes a header action. -->
	<Section title={m.chart_custom_charts()}>
		{#snippet actions()}
			{#if isAdmin}
				<Button size="sm" variant="outline" onclick={openCreate}>
					<Plus class="size-4" />
					{m.chart_new_chart()}
				</Button>
			{/if}
		{/snippet}

		{#if isEmpty}
			<ChartEmptyState {isAdmin} onCreate={openCreate} />
		{:else}
			<ChartGrid
				{charts}
				{range}
				{isAdmin}
				onEdit={openEdit}
				onDelete={requestDelete}
				{onZoom}
				{onResetZoom}
			/>
		{/if}
	</Section>

	<ChartAdminDialogs {isAdmin} bind:editorOpen {editing} {seed} bind:pendingDelete />
{/if}
