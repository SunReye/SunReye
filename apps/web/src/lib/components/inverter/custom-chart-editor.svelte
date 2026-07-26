<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
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

	// Reset the form each time the dialog opens (create → blank, edit → prefill).
	$effect(() => {
		if (!open) return;
		name = chart?.name ?? '';
		selected.clear();
		for (const key of chart?.metrics ?? []) selected.add(key);
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
			<Dialog.Title>{chart ? m.chart_edit_chart() : m.chart_new_chart()}</Dialog.Title>
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
					<div class="flex flex-col p-1">
						{#each groups as [category, metrics] (category)}
							<div
								class="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"
							>
								{category}
							</div>
							{#each metrics as metric (metric.key)}
								{@const checked = selected.has(metric.key)}
								<label
									class="flex cursor-pointer items-center gap-2 rounded-xs px-2 py-1.5 text-sm hover:bg-muted/50 has-disabled:cursor-not-allowed has-disabled:opacity-50"
								>
									<Checkbox
										{checked}
										disabled={!checked && atLimit}
										onCheckedChange={() => toggle(metric.key)}
									/>
									<span class="truncate">{metric.label}</span>
									{#if metric.unit}
										<span class="ml-auto shrink-0 text-xs text-muted-foreground">{metric.unit}</span>
									{/if}
								</label>
							{/each}
						{:else}
							<div class="px-2 py-6 text-center text-sm text-muted-foreground">
								{m.chart_no_metrics_match({ query: search })}
							</div>
						{/each}
					</div>
				</ScrollArea>
			</div>

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>{m.action_cancel()}</Button>
			<Button disabled={!canSave} onclick={save}>{saving ? m.action_saving() : m.action_save()}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
