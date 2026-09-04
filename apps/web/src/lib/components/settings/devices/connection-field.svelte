<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import { type Refusal, connectionOptions } from './add-device-logic';
	import { type AddDeviceForm, type ConnectionView, NEW_CONNECTION } from './device-types';
	import FieldProblem from './field-problem.svelte';
	import NewConnectionFields from './new-connection-fields.svelte';

	// Step 1: the gateway. An existing connection, or the "new" option that
	// reveals the endpoint fields underneath.
	let {
		form = $bindable(),
		connections,
		refusal,
		allowNew = true
	}: {
		form: AddDeviceForm;
		connections: ConnectionView[];
		refusal: Refusal | null;
		/** Whether the "new connection" arm is offered — not when editing a device. */
		allowNew?: boolean;
	} = $props();

	const options = $derived(connectionOptions(connections));
	const isNew = $derived(form.connectionChoice === NEW_CONNECTION);
	// The server names the add body's field `connection` and the patch's `connectionId`.
	const problemField = $derived(refusal?.field === 'connectionId' ? 'connectionId' : 'connection');
</script>

<div class="flex flex-col gap-1.5">
	<Label for="device-connection">{m.devices_field_connection()}</Label>
	<NativeSelect.Root id="device-connection" class="w-full" bind:value={form.connectionChoice}>
		{#each options as option (option.value)}
			<NativeSelect.Option value={option.value}>{option.label}</NativeSelect.Option>
		{/each}
		{#if allowNew}
			<NativeSelect.Option value={NEW_CONNECTION}>{m.devices_connection_new()}</NativeSelect.Option>
		{/if}
	</NativeSelect.Root>
	<FieldProblem field={problemField} {refusal} />
</div>

{#if isNew}
	<NewConnectionFields bind:connection={form.newConnection} />
{/if}
