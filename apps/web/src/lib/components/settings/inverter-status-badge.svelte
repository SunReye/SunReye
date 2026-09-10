<script lang="ts">
	import StatusBadge from "./status-badge.svelte";
	import type { InverterStatus } from "./inverter-types";
	import * as m from "$lib/paraglide/messages";

	// Connection pill for the inverter panel header — shown only when there is
	// something to say. A healthy link needs no badge: "Connected" is the state
	// nobody acts on, and it sat in the loudest position on the page. A DEAD link
	// still speaks, and so does a SIMULATED one, which is not a real link at all
	// and must never be mistaken for one.
	//
	// Renders nothing until status arrives, and nothing once it is simply fine.
	let { status }: { status: InverterStatus | null } = $props();

	const label = $derived(
		status?.simulate ? m.inverter_status_simulated() : m.inverter_status_disconnected()
	);
	const quiet = $derived(status !== null && status.connected && !status.simulate);
</script>

{#if status && !quiet}
	<StatusBadge ok={status.connected} {label} />
{/if}
