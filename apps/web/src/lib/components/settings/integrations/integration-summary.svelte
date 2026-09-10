<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { resolve } from '$lib/resolve';
	import IntegrationPills from './integration-pills.svelte';
	import type { ConnectionView, IntegrationView } from '../devices/device-types';
	import { integrationStatus } from './integration-detail';
	import IntegrationStatusDetail from './integration-status-detail.svelte';

	// WHAT THIS INTEGRATION IS DOING RIGHT NOW.
	//
	// Two badges: whether it is switched on (its configuration) and whether its
	// endpoint is actually open (a measurement). They are unrelated, which is why
	// they are two — an enabled integration on a dead broker is the state an
	// operator most needs to see, and one combined pill cannot show it.
	//
	// The connection is a LINK back to the devices page, because that page is the
	// one that answers "why is nothing arriving": a connection is the thing that
	// fails, and its card holds the endpoint's address, its probe and its Edit.
	let {
		integration,
		connection
	}: {
		integration: IntegrationView;
		/** The endpoint it runs over, or null for a coded thing that needs none. */
		connection: ConnectionView | null;
	} = $props();

	const status = $derived(integrationStatus(integration));
	const enabledLabel = $derived(m.devices_integration_disabled());
</script>

<div class="flex flex-col gap-3 text-sm" data-integration-status>
	<IntegrationPills {status} enabled={integration.enabled} disabledLabel={enabledLabel} />

	<IntegrationStatusDetail {status} />

	<p class="text-xs text-muted-foreground">
		{#if connection}
			<a class="underline underline-offset-4" href={resolve('/settings/devices')}>
				{connection.name}
			</a>
		{:else}
			{m.integration_connection_none()}
		{/if}
	</p>
</div>
