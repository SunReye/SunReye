<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { IntegrationWithDevices } from './add-device-logic';
	import type { DeviceView, IntegrationView } from './device-types';
	import IntegrationEntry from './integration-entry.svelte';

	// The integrations half of a connection's card, under the devices read
	// straight through the endpoint and clearly separated from them: they answer
	// two different questions about the same endpoint — what READS through it,
	// and what RUNS over it — and a single undivided list read as one kind of
	// thing.
	//
	// Each entry now owns the devices it provided, so this half is where most of
	// a broker's card lives: an EVCC ingest with its loadpoints under it, rather
	// than the loadpoints above and the ingest below as strangers.
	//
	// Renders nothing at all when there are none: an integration exists once it
	// has been added, so an empty heading would be a placeholder for something
	// that is deliberately not there.
	let {
		entries,
		busyId,
		busyIntegrationId,
		onEdit,
		onRename,
		onRetire,
		onRestore,
		onEditIntegration,
		onToggleIntegration,
		onRemoveIntegration
	}: {
		entries: readonly IntegrationWithDevices[];
		/** The device id a request is in flight for, or null. */
		busyId: number | null;
		/** The integration id a request is in flight for, or null. */
		busyIntegrationId: number | null;
		onEdit: (device: DeviceView) => void;
		onRename: (device: DeviceView) => void;
		onRetire: (device: DeviceView) => void;
		onRestore: (device: DeviceView) => void;
		onEditIntegration: (integration: IntegrationView) => void;
		onToggleIntegration: (integration: IntegrationView, enabled: boolean) => void;
		onRemoveIntegration: (integration: IntegrationView) => void;
	} = $props();
</script>

{#if entries.length > 0}
	<div class="flex flex-col gap-1 border-t border-border pt-4">
		<h3 class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
			{m.devices_integrations_heading()}
		</h3>
		<div class="flex flex-col divide-y divide-border" data-integrations>
			{#each entries as entry (entry.integration.id)}
				<IntegrationEntry
					{entry}
					{busyId}
					{busyIntegrationId}
					{onEdit}
					{onRename}
					{onRetire}
					{onRestore}
					{onEditIntegration}
					{onToggleIntegration}
					{onRemoveIntegration}
				/>
			{/each}
		</div>
	</div>
{/if}
