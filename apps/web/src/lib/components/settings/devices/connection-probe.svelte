<script lang="ts">
	import { api } from '$lib/api';
	import { apiErrorText } from '$lib/api-error';
	import { Button } from '$lib/components/ui/button';
	import * as m from '$lib/paraglide/messages';
	import { connectionProbeAnswer, describeConnectionProbe } from './add-device-logic';
	import { type ConnectionDraft, connectionParamsOf } from './connection-draft';

	// Is the endpoint there? PER KIND (#217): a Modbus gateway answers a TCP
	// connect to host:port, a broker answers an MQTT CONNECT — and a TCP connect
	// to a broker's port succeeds for every broker that is running, credentials
	// wrong or not, which is the exact misconfiguration the operator opened the
	// dialog to find.
	//
	// No unit id, no profile, no register read: an address can answer nothing
	// more, and the register read lives on the device dialog, which knows what to
	// read with. The wording is decided in `./add-device-logic.ts`.
	//
	// BINDABLE because a Solarman probe brings something BACK. The logger stick
	// names itself in its handshake, and that serial is a field the operator
	// would otherwise read off a sticker behind the inverter — so the probe fills
	// it in. It writes that one field and nothing else: everything in the draft
	// was typed by somebody, and a test is not permission to overwrite it.
	let { draft = $bindable() }: { draft: ConnectionDraft } = $props();

	let probing = $state(false);
	let outcome = $state<{ ok: boolean; message: string } | null>(null);

	const body = $derived(connectionParamsOf(draft));
	const blocked = $derived(probing || body === null);
	const outcomeClass = $derived(outcome?.ok ? 'text-emerald-500' : 'text-destructive');

	/** What to say when the REQUEST failed, so there is no answer body to read. */
	function failureText(error: { value: unknown } | null): string {
		return apiErrorText(error?.value, m.conn_request_failed());
	}

	async function probe() {
		const target = body;
		if (!target) return;
		probing = true;
		outcome = null;
		const { data, error } = await api.api.connections.probe.post(target);
		probing = false;
		const answer = connectionProbeAnswer(data, failureText(error));
		if (answer.ok && answer.serial !== undefined) draft.modbus.loggerSerial = answer.serial;
		outcome = describeConnectionProbe(target.kind, answer);
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
