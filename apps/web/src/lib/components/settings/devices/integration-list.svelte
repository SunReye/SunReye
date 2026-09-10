<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { IntegrationView } from './device-types';
	import IntegrationRow from './integration-row.svelte';

	// The integrations half of a connection's card, under the devices and clearly
	// separated from them: they answer two different questions about the same
	// endpoint — what READS through it, and what RUNS over it — and a single
	// undivided list read as one kind of thing.
	//
	// Renders nothing at all when there are none: an integration exists once it
	// has been added, so an empty heading would be a placeholder for something
	// that is deliberately not there.
	let {
		integrations,
		busyId,
		onEdit,
		onToggle,
		onRemove
	}: {
		integrations: readonly IntegrationView[];
		/** The integration id a request is in flight for, or null. */
		busyId: number | null;
		onEdit: (integration: IntegrationView) => void;
		onToggle: (integration: IntegrationView, enabled: boolean) => void;
		onRemove: (integration: IntegrationView) => void;
	} = $props();
</script>

{#if integrations.length > 0}
	<div class="flex flex-col gap-1 border-t border-border pt-4">
		<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
			{m.devices_integrations_heading()}
		</h3>
		<div class="flex flex-col divide-y divide-border" data-integrations>
			{#each integrations as integration (integration.id)}
				<IntegrationRow
					{integration}
					busy={busyId === integration.id}
					{onEdit}
					{onToggle}
					{onRemove}
				/>
			{/each}
		</div>
	</div>
{/if}
