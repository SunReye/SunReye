<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$lib/resolve';

	// There is no list of integrations of its own, on purpose: a connection is
	// the thing that fails, so "what is configured on this plant" is answered by
	// Settings → Devices, grouped by endpoint, with each integration owning the
	// devices it provides. Only ONE integration has a page (`./[id]`).
	//
	// The path exists anyway so a hand-typed or truncated URL lands on the list
	// rather than on a 404 — the same reason `/settings/inverter` is still here.
	$effect(() => {
		goto(resolve('/settings/devices'), { replaceState: true });
	});
</script>
