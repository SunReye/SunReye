<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import Section from '$lib/components/layout/section.svelte';
	import { resolve } from '$lib/resolve';
	import * as m from '$lib/paraglide/messages';
	import { type DeviceGroup, groupIsEmpty, nestIntegrations } from './add-device-logic';
	import DeviceRows from './device-rows.svelte';
	import type { ConnectionView, DeviceHandlers, IntegrationHandlers } from './device-types';
	import IntegrationList from './integration-list.svelte';

	// One group of the roster as a collapsible card: a gateway and the devices
	// reached through it, an integration and the devices it feeds, the internal
	// devices, or the ones with no endpoint and no reason for it.
	//
	// A card answers one question — WHAT IS ON THIS ENDPOINT — and that has two
	// halves: the devices READ through the connection, and, below them, the
	// integrations that RUN over it. They used to live on separate tabs, so an
	// operator looking at a broker saw its loadpoints and no sign of the EVCC
	// ingest that provisioned them.
	//
	// A gateway is edited from HERE, not from one of its devices: one save moves
	// every device below, and the header is where that is visible. The other three
	// kinds have no header actions — there is nothing on a group of them to edit.
	let {
		group,
		busyId,
		busyIntegrationId,
		onEditConnection,
		handlers,
		integrationHandlers
	}: {
		group: DeviceGroup;
		busyId: number | null;
		busyIntegrationId: number | null;
		onEditConnection: (connection: ConnectionView) => void;
		handlers: DeviceHandlers;
		integrationHandlers: IntegrationHandlers;
	} = $props();

	const connection = $derived(group.connection);
	// The caption is decided in `add-device-logic.ts`, per KIND: a gateway says
	// how it is framed and how often it is read, a broker says which broker it is.
	const caption = $derived(group.caption ?? undefined);
	// Empty means BOTH halves empty — a broker whose EVCC ingest is configured and
	// whose first message has not landed yet has something to show.
	const empty = $derived(groupIsEmpty(group));
	// The devices an integration PROVIDED move under it; what is left at the top
	// is what is read straight through the endpoint. `nestIntegrations` owns that
	// split, and its test owns the awkward cases — a retired loadpoint, an
	// integration that provisions nothing, two ingests on one broker.
	const nested = $derived(nestIntegrations(group));
</script>

<Section title={group.title} {caption} nested collapsible open>
	{#snippet actions()}
		{#if connection}
			<Button
				size="sm"
				variant="outline"
				class="h-9 sm:h-8"
				aria-label={m.devices_edit_connection()}
				onclick={() => onEditConnection(connection)}
			>
				<!-- "Edit" alone on a phone: the card's title already names the
				     connection, and the long label squeezed its caption into a
				     three-line column. -->
				<span class="sm:hidden">{m.devices_action_edit()}</span>
				<span class="hidden sm:inline">{m.devices_edit_connection()}</span>
			</Button>
		{/if}
	{/snippet}
	{#if empty}
		<!-- One line, not the page-sized EmptyState: an endpoint with nothing on
		     it yet is a normal step of adding one, and a 128px box per connection
		     pushed the rest of the roster off a phone screen. -->
		<p class="text-sm text-muted-foreground" data-group-empty>
			{m.devices_group_empty()}
			<a class="font-medium text-foreground underline underline-offset-4" href={resolve('/settings/devices/add')}>
				{m.devices_group_empty_add()}
			</a>
		</p>
	{:else}
		<DeviceRows devices={nested.devices} {busyId} groupKey={group.key} {handlers} />
		<IntegrationList
			entries={nested.integrations}
			{busyId}
			{busyIntegrationId}
			{handlers}
			{integrationHandlers}
		/>
	{/if}
</Section>
