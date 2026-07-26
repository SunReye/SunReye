<script lang="ts">
	import Check from 'phosphor-svelte/lib/Check';

	// One dot of the wizard rail: a check once the step is done, its number
	// otherwise, with the connecting lines coloured up to the current step. The
	// first and last dots drop their outer line so the rail doesn't overhang.
	let {
		label,
		index,
		total,
		current
	}: {
		label: string;
		index: number;
		total: number;
		/** Index of the step being shown. */
		current: number;
	} = $props();

	const state = $derived(index < current ? 'done' : index === current ? 'current' : 'upcoming');
	const leadClass = $derived(
		index === 0 ? 'bg-transparent' : index <= current ? 'bg-primary' : 'bg-border'
	);
	const trailClass = $derived(
		index === total - 1 ? 'bg-transparent' : index < current ? 'bg-primary' : 'bg-border'
	);
	const dotClass = $derived(
		state === 'done'
			? 'border-primary bg-primary text-primary-foreground'
			: state === 'current'
				? 'border-primary text-primary'
				: 'border-border text-muted-foreground'
	);
	const labelClass = $derived(
		state === 'upcoming' ? 'text-muted-foreground' : 'font-medium text-foreground'
	);
</script>

<li class="flex flex-1 flex-col items-center gap-2">
	<div class="flex w-full items-center">
		<span class="h-px flex-1 {leadClass}"></span>
		<span
			class="flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors {dotClass}"
		>
			{#if state === 'done'}
				<Check class="size-4" weight="bold" />
			{:else}
				{index + 1}
			{/if}
		</span>
		<span class="h-px flex-1 {trailClass}"></span>
	</div>
	<span class="text-center text-xs {labelClass}">
		{label}
	</span>
</li>
