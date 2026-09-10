<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { AttachOption } from './add-wizard';
	import AttachOptionButton from './attach-option.svelte';

	// STEP 2 — what to attach, from the SERVER's catalog for this connection's
	// kind. Nothing here knows what an EVCC ingest is; a new integration is a
	// server change and no edit to this file.
	let {
		options,
		entryId = $bindable(null)
	}: {
		options: readonly AttachOption[];
		entryId: string | null;
	} = $props();
</script>

{#if options.length === 0}
	<EmptyState message={m.wizard_attach_empty()} />
{:else}
	<div class="flex flex-col gap-2">
		{#each options as option (option.entry.id)}
			<AttachOptionButton
				{option}
				chosen={entryId === option.entry.id}
				onpick={() => (entryId = option.entry.id)}
			/>
		{/each}
	</div>
{/if}
