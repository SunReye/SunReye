<script lang="ts">
	// One editable TOU table cell. Empty when the profile doesn't map the register;
	// otherwise an input whose write commits on change, and only for a value that
	// actually parses — a half-typed number or a cleared time never reaches the
	// inverter.
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { hhmmToLabel, labelToHhmm, type TouController } from '$lib/inverter/tou.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';

	let {
		controller,
		metric,
		kind,
		step,
		min,
		max
	}: {
		controller: TouController;
		/** The slot's metric for this column, or undefined for an empty cell. */
		metric: ManifestMetric | undefined;
		/** `time` reads/writes hh:mm; `number` the raw register value. */
		kind: 'time' | 'number';
		step?: string;
		min?: string;
		max?: string;
	} = $props();

	const CLASSES = { time: 'w-28', number: 'w-24 tabular-nums' } as const;

	/** Blank rather than 0 while the register is unread. */
	function read(m: ManifestMetric): string | number {
		const raw = controller.value(m.key);
		return kind === 'time' ? hhmmToLabel(raw) : (raw ?? '');
	}

	const parseNumber = (raw: string) => {
		const v = Number(raw);
		return raw === '' || Number.isNaN(v) ? null : v;
	};

	function commit(m: ManifestMetric, raw: string) {
		const v = kind === 'time' ? labelToHhmm(raw) : parseNumber(raw);
		if (v !== null) controller.write(m.key, v, m.label);
	}
</script>

<Table.Cell>
	{#if metric}
		<Input
			type={kind}
			{step}
			{min}
			{max}
			class={CLASSES[kind]}
			value={read(metric)}
			disabled={controller.busy(metric.key)}
			onchange={(e) => commit(metric, e.currentTarget.value)}
		/>
	{/if}
</Table.Cell>
