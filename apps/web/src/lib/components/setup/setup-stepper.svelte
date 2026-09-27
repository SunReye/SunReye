<script lang="ts">
	import SetupStepMarker from './setup-step-marker.svelte';

	// Numbered progress rail above the first-run steps. An ordered list with the
	// current step marked, so a screen reader hears "step 2 of 4" rather than a
	// row of numbers.
	let {
		steps,
		current
	}: {
		steps: { key: string; label: string }[];
		/** Index of the step being shown. */
		current: number;
	} = $props();
</script>

<ol class="flex items-start">
	{#each steps as s, i (s.key)}
		<SetupStepMarker label={s.label} index={i} total={steps.length} {current} />
	{/each}
</ol>
