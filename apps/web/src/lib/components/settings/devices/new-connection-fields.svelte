<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import type { NewConnection } from './device-types';

	// The endpoint a new connection needs — the same six fields the inverter form
	// edits, with the same defaults, minus the unit id (that is the device's).
	let { connection = $bindable() }: { connection: NewConnection } = $props();

	const TRANSPORTS = [
		{ value: 'tcp', label: 'Modbus TCP' },
		{ value: 'rtu-over-tcp', label: 'Modbus RTU over TCP' }
	] as const;
</script>

<div class="grid grid-cols-1 gap-4 bg-muted/40 p-3 sm:grid-cols-2">
	<div class="flex flex-col gap-1.5 sm:col-span-2">
		<Label for="connection-name">{m.devices_field_connection_name()}</Label>
		<Input id="connection-name" bind:value={connection.name} maxlength={64} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="connection-host">{m.devices_field_host()}</Label>
		<Input id="connection-host" bind:value={connection.host} autocomplete="off" />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="connection-port">{m.devices_field_port()}</Label>
		<Input id="connection-port" type="number" min={1} max={65535} bind:value={connection.port} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="connection-transport">{m.inverter_transport()}</Label>
		<NativeSelect.Root id="connection-transport" class="w-full" bind:value={connection.transport}>
			{#each TRANSPORTS as t (t.value)}
				<NativeSelect.Option value={t.value}>{t.label}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="connection-timeout">{m.inverter_timeout()}</Label>
		<Input id="connection-timeout" type="number" min={100} bind:value={connection.timeoutMs} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="connection-poll">{m.inverter_poll_interval()}</Label>
		<Input
			id="connection-poll"
			type="number"
			min={1000}
			step={1000}
			bind:value={connection.pollIntervalMs}
		/>
	</div>
</div>
