<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as m from '$lib/paraglide/messages';
	import KindField from './connection-kind-field.svelte';
	import ModbusFields from './connection-modbus-fields.svelte';
	import MqttFields from './connection-mqtt-fields.svelte';
	import type { ConnectionDraft } from './connection-draft';

	// The endpoint a connection is, per KIND (#217): a Modbus gateway's five
	// addressing fields, or a broker's URL and credentials. The draft holds both
	// halves at once (`./connection-draft.ts`), so switching the select does not
	// empty what was typed in the other one.
	//
	// EDITING NEVER OFFERS THE KIND. `PATCH /api/connections/:id` answers 409 for
	// a kind that differs from the row's, because every device bound to the
	// connection was provisioned for its tier — so the control is a line of text
	// there, and a different kind is a different connection.
	let {
		connection = $bindable(),
		kind = 'choose'
	}: {
		connection: ConnectionDraft;
		/**
		 * How the kind is presented: chosen (a new connection), shown but frozen
		 * (an existing row), or absent (the device dialog's new-gateway arm, where
		 * only a Modbus endpoint is expressible).
		 */
		kind?: 'choose' | 'locked' | 'hidden';
	} = $props();

	const showsKind = $derived(kind !== 'hidden');
</script>

<div class="grid grid-cols-1 gap-4 bg-muted/40 p-3 sm:grid-cols-2">
	<div class="flex flex-col gap-1.5 sm:col-span-2">
		<Label for="connection-name">{m.devices_field_connection_name()}</Label>
		<Input id="connection-name" bind:value={connection.name} maxlength={64} />
	</div>

	{#if showsKind}
		<KindField bind:value={connection.kind} locked={kind === 'locked'} />
	{/if}

	{#if connection.kind === 'modbus'}
		<ModbusFields bind:params={connection.modbus} />
	{:else}
		<MqttFields bind:params={connection.mqtt} hasPassword={connection.hasPassword} />
	{/if}
</div>
