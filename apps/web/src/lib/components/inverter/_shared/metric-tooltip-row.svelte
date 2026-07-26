<script lang="ts">
	// The single-metric row inside a `Chart.Tooltip`: metric label, then the value
	// right-aligned with the metric's own precision and unit suffix. Shared by
	// live-area and entity-history-card so both read identically.
	import { fractionDigits } from '$lib/inverter/format';

	let {
		label,
		value,
		unit
	}: {
		/** Metric name shown on the left. */
		label: string;
		/** Raw value as handed to the formatter snippet. */
		value: unknown;
		/** Unit suffix; also selects the fraction-digit rule. */
		unit: string;
	} = $props();

	const text = $derived(
		`${Number(value).toLocaleString(undefined, fractionDigits(unit))}${unit ? ` ${unit}` : ''}`
	);
</script>

<span class="text-muted-foreground">{label}</span>
<span class="ml-auto font-mono font-medium tabular-nums text-foreground">
	{text}
</span>
