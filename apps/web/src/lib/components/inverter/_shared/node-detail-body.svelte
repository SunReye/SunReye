<script lang="ts">
	// What one node's dialog holds: the subsystem's state on top (the battery's
	// charge bar, the node's own quantity with its history) and its readings
	// below, phase/string blocks last. Split from the dialog itself so neither
	// template carries both the shell and the content.
	import { inverter } from '$lib/inverter/store.svelte';
	import { formatValue } from '$lib/inverter/format';
	import type { NodeDetail } from '$lib/inverter/node-details';
	import BatteryBar from '../battery-bar.svelte';
	import Kpi from '../kpi.svelte';
	import StatRows from './stat-rows.svelte';

	let { detail }: { detail: NodeDetail } = $props();

	/** A role's live value, or undefined when the profile does not map it. */
	function readRole(role: 'battery.soc' | 'battery.power'): number | undefined {
		const metric = inverter.byRole(role);
		return metric ? inverter.value(metric.key) : undefined;
	}

	const headline = $derived.by(() => {
		const primary = detail.primary;
		if (!primary) return undefined;
		const value = inverter.value(primary.metric.key);
		return {
			label: primary.metric.label,
			value,
			text: formatValue(primary.metric, value),
			unit: primary.metric.unit ?? '',
			points: inverter.series(primary.metric.key),
			accent: primary.accent,
			diverging: primary.diverging
		};
	});
</script>

{#if detail.batteryBar}
	<BatteryBar soc={readRole('battery.soc')} power={readRole('battery.power')} />
{/if}

{#if headline}
	<Kpi {...headline} />
{/if}

<StatRows metrics={detail.rows} />

{#each detail.groups as group (group.label)}
	<div class="flex flex-col gap-1">
		<span class="text-xs font-medium">{group.label}</span>
		<StatRows metrics={group.metrics} />
	</div>
{/each}
