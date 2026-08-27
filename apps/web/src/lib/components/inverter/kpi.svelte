<script lang="ts">
	import KpiValue from './_shared/kpi-value.svelte';
	import LiveArea from './live-area.svelte';
	import type { LivePoint } from '$lib/inverter/types';

	let {
		label,
		value,
		text,
		unit = '',
		points = [],
		accent = 'var(--chart-2)',
		diverging = false,
		sub = null
	}: {
		label: string;
		/** Raw numeric value (animated); undefined/non-numeric falls back to `text`. */
		value?: number;
		/** Pre-formatted display used when `value` is not a finite number (status, em dash). */
		text: string;
		unit?: string;
		points?: LivePoint[];
		accent?: string;
		/** Signed metric: split the chart red (consuming) / green (exporting) at 0. */
		diverging?: boolean;
		sub?: string | null;
	} = $props();
</script>

<div class="flex flex-col gap-2 px-4 py-3">
	<span class="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
		{label}
	</span>
	<div class="flex items-baseline gap-1.5">
		<KpiValue {value} {text} {unit} />
		{#if unit}<span class="text-xs text-muted-foreground">{unit}</span>{/if}
	</div>
	{#if sub}
		<span class="text-xs text-muted-foreground">{sub}</span>
	{/if}
	<div class="mt-2">
		{#if points.length > 1}
			<LiveArea {points} {accent} {diverging} {label} {unit} />
		{/if}
	</div>
</div>
