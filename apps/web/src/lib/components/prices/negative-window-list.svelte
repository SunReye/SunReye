<script lang="ts">
	import { negativeHours, type NegativeWindow } from '$lib/prices/price-series';
	import NegativeWindowDay from './negative-window-day.svelte';
	import { decimal } from '$lib/format/number';
	import * as m from '$lib/paraglide/messages';

	let {
		windows,
		emptyLabel
	}: {
		windows: NegativeWindow[];
		/**
		 * What an empty list means, in the caller's words — "none in this period"
		 * for a settled history, but never a claim the data cannot support (an
		 * unpublished day has no negative windows *known*, not none).
		 */
		emptyLabel: string;
	} = $props();

	const hours = $derived(negativeHours(windows));

	// Group by the market-local day so "today" and "tomorrow" read as separate
	// plans rather than one list of times with no date anchor. Windows arrive in
	// chronological order, so grouping consecutive runs is enough.
	const byDate = $derived.by(() => {
		const groups: { date: string; windows: NegativeWindow[] }[] = [];
		for (const w of windows) {
			const last = groups.at(-1);
			if (last?.date === w.date) last.windows.push(w);
			else groups.push({ date: w.date, windows: [w] });
		}
		return groups;
	});

	const summary = $derived(
		windows.length === 1
			? m.prices_negative_summary_one({ hours: decimal(hours, 2) })
			: m.prices_negative_summary_other({
					hours: decimal(hours, 2),
					windows: windows.length
				})
	);
</script>

{#if windows.length > 0}
	<div class="flex flex-col gap-3">
		<p class="text-sm">{summary}</p>
		{#each byDate as group (group.date)}
			<NegativeWindowDay date={group.date} windows={group.windows} />
		{/each}
	</div>
{:else}
	<p class="text-sm text-muted-foreground">{emptyLabel}</p>
{/if}
