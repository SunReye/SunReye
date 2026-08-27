<script lang="ts">
	// One secondary KPI row on an energy card (label left, figure right).
	//
	// Every card renders the same fixed slots so the rows line up across the strip:
	// a slot this card can fill but has no data for yet shows skeletons, a slot it
	// never fills stays empty but keeps its min height.
	import { Skeleton } from '$lib/components/ui/skeleton';

	let {
		loading,
		label,
		value,
		valueClass = '',
		skeletonValueWidth
	}: {
		/** This card uses the slot, but the figures haven't arrived yet. */
		loading: boolean;
		label: string | undefined;
		/** Formatted figure; `undefined` leaves the slot reserved but blank. */
		value: string | undefined;
		/** Extra classes for the figure (e.g. the money rows' colour). */
		valueClass?: string;
		/** Width of the value skeleton, matched to the figure it stands in for. */
		skeletonValueWidth: string;
	} = $props();

	const filled = $derived(label !== undefined && value !== undefined);
</script>

<span class="flex min-h-3.5 items-baseline justify-between gap-2 2xl:min-h-4">
	{#if loading}
		<Skeleton class="h-2.5 w-24 rounded" />
		<Skeleton class="h-2.5 {skeletonValueWidth} rounded" />
	{:else if filled}
		<span
			class="min-w-0 truncate text-[0.6rem] uppercase tracking-wide text-muted-foreground 2xl:text-xs"
		>
			{label}
		</span>
		<span
			class="shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums 2xl:text-sm {valueClass}"
		>
			{value}
		</span>
	{/if}
</span>
