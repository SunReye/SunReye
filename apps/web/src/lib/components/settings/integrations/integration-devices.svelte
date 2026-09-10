<script lang="ts">
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { DeviceView } from '../devices/device-types';
	import IntegrationDeviceRow from './integration-device-row.svelte';

	// THE ANSWER TO "WHAT IS THIS GIVING ME" — every device the integration
	// provided, retired ones included: a device nobody can see is a device nobody
	// can explain, and this page is the one place a retired loadpoint has a
	// reason attached to it.
	//
	// The empty state has words in it because an integration that provisions
	// nothing (the Home Assistant export publishes and yields nothing) is a
	// perfectly healthy state, and a blank card reads as a page that failed.
	let { devices }: { devices: readonly DeviceView[] } = $props();
</script>

{#if devices.length === 0}
	<EmptyState message={m.integration_devices_none()} />
{:else}
	<div class="flex flex-col divide-y divide-border" data-provided>
		{#each devices as device (device.id)}
			<IntegrationDeviceRow {device} />
		{/each}
	</div>
{/if}
