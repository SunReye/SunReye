<script lang="ts">
	import { display } from '$lib/display.svelte';
	import type { IncompleteRange } from '$lib/history-incomplete';
	import * as m from '$lib/paraglide/messages';

	/**
	 * The ranges this instance refused to answer, one line each.
	 *
	 * Never "some data is missing". The TIER and the BOUNDARY are the two things that
	 * make the refusal actionable: a year-long window is complete at day resolution
	 * and truncated at minute resolution, and the honest answer to the second is "ask
	 * for a wider bucket". See `$lib/history-incomplete.ts` for where these come from
	 * and why they are collected in one place rather than at ten call sites.
	 */
	let { ranges }: { ranges: readonly IncompleteRange[] } = $props();
</script>

<div class="flex flex-col gap-1">
	<span>{m.migration_incomplete_heading()}</span>
	{#each ranges as range (range.tier + range.from)}
		<span class="text-xs">
			{m.migration_incomplete_range({
				date: display.day(new Date(range.from)),
				tier: range.tier
			})}
		</span>
	{/each}
</div>
