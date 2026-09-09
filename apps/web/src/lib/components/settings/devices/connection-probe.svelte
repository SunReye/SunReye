<script lang="ts">
	import { api } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import type { NewConnection } from './device-types';

	// Is the gateway there? One TCP connect to the draft's host:port. No unit id,
	// no profile, no register read — an address can answer nothing more, and the
	// register read lives on the device dialog, which knows what to read with.
	let { draft }: { draft: NewConnection } = $props();

	let probing = $state(false);
	let outcome = $state<{ ok: boolean; message: string } | null>(null);

	const host = $derived(draft.host.trim());
	const blocked = $derived(probing || host === '');
	const outcomeClass = $derived(outcome?.ok ? 'text-emerald-500' : 'text-destructive');

	async function probe() {
		probing = true;
		outcome = null;
		const { data, error } = await api.api.connections.probe.post({
			host,
			port: draft.port,
			timeoutMs: draft.timeoutMs
		});
		probing = false;
		outcome = describe(data ?? { ok: false, error: error ? String(error.value) : m.conn_request_failed() });
	}

	function describe(result: { ok: boolean; ms?: number; error?: string }) {
		return result.ok
			? { ok: true, message: m.devices_ping_ok({ ms: result.ms ?? 0 }) }
			: { ok: false, message: m.devices_ping_failed({ error: result.error ?? '' }) };
	}
</script>

<div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
	<Button type="button" variant="outline" size="sm" disabled={blocked} onclick={probe}>
		{probing ? m.conn_testing() : m.conn_test()}
	</Button>
	{#if outcome}
		<span class={outcomeClass}>{outcome.message}</span>
	{/if}
</div>
