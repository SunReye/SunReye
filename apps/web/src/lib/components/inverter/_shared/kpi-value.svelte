<script lang="ts">
	// The headline figure of a KPI tile. A finite number animates between samples;
	// anything else (a status string, an em dash for "no reading") renders as the
	// pre-formatted `text` at the same size and weight.
	import AnimatedNumber from '$lib/components/inverter/animated-number.svelte';

	let {
		value,
		text,
		unit = ''
	}: {
		/** Raw numeric value (animated); undefined/non-numeric falls back to `text`. */
		value?: number;
		/** Pre-formatted display used when `value` is not a finite number. */
		text: string;
		unit?: string;
	} = $props();

	const animate = $derived(value !== undefined && Number.isFinite(value));
</script>

{#if animate}
	<AnimatedNumber
		value={value as number}
		{unit}
		class="text-2xl font-semibold tabular-nums leading-none"
	/>
{:else}
	<span class="text-2xl font-semibold tabular-nums leading-none">{text}</span>
{/if}
