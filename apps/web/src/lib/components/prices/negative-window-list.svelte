<script lang="ts">
	import { negativeHours, type NegativeWindow } from '$lib/prices/price-series';
	import NegativeWindowDay from './negative-window-day.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		windows,
		showEmpty
	}: {
		windows: NegativeWindow[];
		/**
		 * Whether "no negative prices" may be stated. False while tomorrow is
		 * unpublished: an empty list then means *unknown*, and claiming there are
		 * none would be a claim the data cannot support.
		 */
		showEmpty: boolean;
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
		m.prices_negative_summary({
			hours: hours.toLocaleString(undefined, { maximumFractionDigits: 2 }),
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
{:else if showEmpty}
	<p class="text-sm text-muted-foreground">{m.prices_no_negative()}</p>
{/if}
