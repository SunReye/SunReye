<script lang="ts">
	// One saved chart in the "add to chart" menu: a tick when it already draws
	// this metric, disabled when it is full. Its own file because the menu's
	// template crossed the complexity gate with the row inline.
	import Check from 'phosphor-svelte/lib/Check';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as m from '$lib/paraglide/messages';
	import { MAX_CHART_METRICS } from '$lib/inverter/custom-chart';
	import type { MembershipItem } from '$lib/inverter/chart-membership';

	let {
		item,
		busy = false,
		onPick
	}: { item: MembershipItem; busy?: boolean; onPick: () => void } = $props();

	// Disabled only when the chart is full AND does not already hold this metric
	// — see `membership`: taking a series back off a full chart has to stay
	// possible, or a chart at its limit can never be edited from here again.
	const full = $derived(item.full);
	const hint = $derived(full ? m.chart_chart_full({ count: MAX_CHART_METRICS }) : undefined);
</script>

<DropdownMenu.Item disabled={full || busy} onSelect={onPick} title={hint}>
	<Check class={['size-4 shrink-0', !item.holds && 'invisible']} />
	<span class="truncate">{item.name}</span>
</DropdownMenu.Item>
