<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { api } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import { inverter } from '$lib/inverter/store.svelte';
	import ControlEnum from './_shared/control-enum.svelte';
	import ControlNumeric from './_shared/control-numeric.svelte';
	import type { ManifestMetric } from '$lib/inverter/types';

	let { metric }: { metric: ManifestMetric } = $props();

	const live = $derived(inverter.value(metric.key));
	const enumKeys = $derived(
		metric.enumLabels ? Object.keys(metric.enumLabels).map(Number).sort((a, b) => a - b) : []
	);

	// Local pending value wins over the streamed value once the user acts.
	let pending = $state<number | null>(null);
	const value = $derived(pending ?? live ?? metric.range?.min ?? 0);

	/** Enum settings read out as their label; everything else as the raw number. */
	const valueLabel = (v: number) => metric.enumLabels?.[v] ?? v;
	const readout = $derived(`${valueLabel(value)}${metric.unit ? ` ${metric.unit}` : ''}`);

	// Seed the number field with the live value so the browser's native up/down
	// stepper increments from the current reading instead of starting at 1.
	// Reseed only when the underlying value actually changes — not merely when
	// the field loses focus — so a typed-but-unsubmitted edit survives the blur
	// that fires when the user clicks Apply.
	let inputValue = $state('');
	let seeded = $state<number>();
	$effect(() => {
		if (value !== seeded) {
			seeded = value;
			inputValue = String(value);
		}
	});

	let busy = $state(false);
	async function write(v: number) {
		busy = true;
		pending = v;
		try {
			const { error } = await api.api.commands.setting.post({ key: metric.key, value: v });
			if (error) throw error;
			toast.success(`${metric.label} → ${valueLabel(v)}`);
		} catch {
			toast.error(m.controls_toast_update_failed({ name: metric.label }));
			pending = null;
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-2 border-b border-border/40 py-3 last:border-b-0">
	<div class="flex items-center justify-between gap-4">
		<span class="text-sm font-medium">{metric.label}</span>
		<span class="text-xs tabular-nums text-muted-foreground">{readout}</span>
	</div>

	{#if metric.enumLabels}
		<ControlEnum enumLabels={metric.enumLabels} {enumKeys} {value} {busy} onWrite={write} />
	{:else}
		<ControlNumeric
			range={metric.range}
			{value}
			bind:inputValue
			{busy}
			onWrite={write}
			onDrag={(v) => (pending = v)}
		/>
	{/if}
</div>
