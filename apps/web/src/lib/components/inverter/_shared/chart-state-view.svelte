<script lang="ts">
	// Placeholder shown in a chart card's plot area while there is no chart to draw:
	// a skeleton for an in-flight query, otherwise a centred explanation (no metrics
	// resolved, or the range came back empty).
	import { Skeleton } from '$lib/components/ui/skeleton';

	let {
		loading,
		message
	}: {
		loading: boolean;
		/** Explanation for the non-loading states. */
		message: string;
	} = $props();
</script>

{#if loading}
	<Skeleton class="h-full w-full" />
{:else}
	<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
		{message}
	</div>
{/if}
