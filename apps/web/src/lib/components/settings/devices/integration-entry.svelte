<script lang="ts">
	import type { IntegrationWithDevices } from './add-device-logic';
	import DeviceRows from './device-rows.svelte';
	import type { DeviceView, IntegrationView } from './device-types';
	import IntegrationRow from './integration-row.svelte';

	// ONE integration, and under it the devices it provides.
	//
	// The nesting IS the fix. `Carport` is a loadpoint that exists because the
	// EVCC ingest discovered it; the shipped card listed the two as unrelated
	// siblings with a "via MQTT" badge as the only hint of the relationship. The
	// indent and the rule down the left say it structurally instead, so the badge
	// no longer has to carry the whole explanation.
	//
	// Which devices those are is `nestIntegrations`' decision and its test's —
	// the same `YIELDED_PROFILES` rule the Remove dialog names its retirements
	// from, so the card and the confirm cannot disagree.
	let {
		entry,
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
		entry: IntegrationWithDevices;
		busyId: number | null;
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

<div class="flex flex-col">
	<IntegrationRow
		integration={entry.integration}
		busy={busyIntegrationId === entry.integration.id}
		onEdit={onEditIntegration}
		onToggle={onToggleIntegration}
		onRemove={onRemoveIntegration}
	/>
	<!-- `pl-3 sm:pl-4` with a rule down the left: the indent has to survive
	     400px, where a deeper one would leave a device name a word wide. The
	     wrapper is always present so `DeviceRows` alone decides whether an
	     integration with nothing yet renders anything at all. -->
	<div class="ml-1 border-l border-border pl-3 sm:pl-4" data-provided-by={entry.integration.id}>
		<DeviceRows
			devices={entry.devices}
			{busyId}
			groupKey={`integration-${entry.integration.id}`}
			{onEdit}
			{onRename}
			{onRetire}
			{onRestore}
		/>
	</div>
</div>
