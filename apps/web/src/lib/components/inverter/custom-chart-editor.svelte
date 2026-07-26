<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import MetricPickerList from '$lib/components/inverter/_shared/metric-picker-list.svelte';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import {
		chartableMetrics,
		searchedGroups
	} from '$lib/components/inverter/_shared/metric-catalog';
	import {
		MAX_CHART_METRICS,
		type CustomChart,
		customCharts
	} from '$lib/inverter/custom-charts.svelte';

	let {
		open = $bindable(false),
		chart = null
	}: {
		open?: boolean;
		/** Chart being edited, or `null` to create a new one. */
		chart?: CustomChart | null;
	} = $props();

	let name = $state('');
	// SvelteSet is reactive on mutation, so it stays a const and we clear/refill it
	// (rather than reassign) when the dialog opens.
	const selected = new SvelteSet<string>();
	let search = $state('');
	let error = $state<string | null>(null);
	let saving = $state(false);

	const BLANK_DRAFT = { name: '', metrics: [] as string[] };
	/** The chart under edit, or blanks when creating a new one. */
	const draftOf = (c: CustomChart | null) => c ?? BLANK_DRAFT;

	// Reset the form each time the dialog opens (create → blank, edit → prefill).
	$effect(() => {
		if (!open) return;
		const draft = draftOf(chart);
		name = draft.name;
		selected.clear();
		for (const key of draft.metrics) selected.add(key);
		search = '';
		error = null;
	});

	const chartable = $derived(chartableMetrics(inverter.metrics));
	const groups = $derived(searchedGroups(chartable, search));

	const atLimit = $derived(selected.size >= MAX_CHART_METRICS);

	function toggle(key: string) {
		if (selected.has(key)) selected.delete(key);
		else if (!atLimit) selected.add(key);
	}

	const canSave = $derived(name.trim().length > 0 && selected.size > 0 && !saving);

	const title = $derived(chart ? m.chart_edit_chart() : m.chart_new_chart());
	const saveLabel = $derived(saving ? m.action_saving() : m.action_save());
	const isSelected = (key: string) => selected.has(key);

	async function save() {
		if (!canSave) return;
		saving = true;
		error = null;
		const input = { name: name.trim(), metrics: [...selected] };
		const err = chart
			? await customCharts.update(chart.id, input)
			: await customCharts.create(input);
		saving = false;
		if (err) {
			error = err;
			return;
		}
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] gap-0 overflow-hidden sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				{m.chart_editor_desc({ count: MAX_CHART_METRICS })}
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label for="chart-name">{m.chart_name_label()}</Label>
				<Input id="chart-name" bind:value={name} placeholder={m.chart_name_placeholder()} />
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<Label>{m.chart_metrics_label()}</Label>
					<span class="text-xs text-muted-foreground">{selected.size}/{MAX_CHART_METRICS}</span>
				</div>
				<div class="relative">
					<MagnifyingGlass
						class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input placeholder={m.chart_search_metrics()} bind:value={search} class="pl-9" />
				</div>
				<ScrollArea class="h-64 border border-border">
					<MetricPickerList
						{groups}
						{isSelected}
						{atLimit}
						onToggle={toggle}
						emptyQuery={search}
					/>
				</ScrollArea>
			</div>

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{m.action_cancel()}</Button>
			<Button disabled={!canSave} onclick={save}>{saveLabel}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
