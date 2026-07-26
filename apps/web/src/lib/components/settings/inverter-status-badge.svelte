<script lang="ts">
	import StatusBadge from "./status-badge.svelte";
	import type { InverterStatus } from "./inverter-types";
	import * as m from "$lib/paraglide/messages";

	// Connection pill for the inverter panel header. A simulated engine reports
	// as such rather than as a real link. Renders nothing until status arrives.
	let { status }: { status: InverterStatus | null } = $props();

	const label = $derived(
		status?.simulate
			? m.inverter_status_simulated()
			: status?.connected
				? m.status_connected()
				: m.inverter_status_disconnected()
	);
</script>

{#if status}
	<StatusBadge ok={status.connected} {label} />
{/if}
