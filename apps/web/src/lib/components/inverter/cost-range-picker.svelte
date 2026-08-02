<script lang="ts">
	import PresetRangePicker from '$lib/components/inverter/preset-range-picker.svelte';
	import { presetLabel, rangeLabel } from '$lib/cost/labels';
	import {
		COST_PRESETS,
		resolveCostPreset,
		customCostRange,
		type CostRange
	} from '$lib/cost/ranges';

	// Costs range picker: named presets (Today … This year) plus a custom calendar.
	// Emits a CostRange carrying both the tiles window and the contextual chart spec.
	let { range = $bindable() }: { range: CostRange } = $props();

	const presets = $derived(
		COST_PRESETS.map((p) => ({ id: p.id, label: presetLabel(p.id, p.label) }))
	);
	const triggerLabel = $derived(rangeLabel(range));
</script>

<PresetRangePicker
	{presets}
	activeId={range.id}
	{triggerLabel}
	onPreset={(id) => (range = resolveCostPreset(id))}
	onCustomRange={(start, end) => (range = customCostRange(start, end))}
/>
