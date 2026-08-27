<script lang="ts">
	import StatusBadge from './status-badge.svelte';
	import type { MqttStatus } from './mqtt-types';
	import * as m from '$lib/paraglide/messages';

	// Broker pill for the MQTT panel header: disabled beats connection state, and
	// an enabled-but-unlinked broker reads as still connecting rather than down.
	let { status }: { status: MqttStatus | null } = $props();

	const label = $derived(
		!status?.enabled
			? m.mqtt_status_disabled()
			: status.connected
				? m.status_connected()
				: m.status_connecting()
	);
</script>

{#if status}
	<StatusBadge ok={status.connected} {label} />
{/if}
