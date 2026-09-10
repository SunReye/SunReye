<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import type { ModbusDraft } from './connection-draft';

	// A Modbus gateway's addressing: the five columns `connections.params`
	// replaced, with the same defaults they carried.
	let { params = $bindable() }: { params: ModbusDraft } = $props();

	const TRANSPORTS = [
		{ value: 'tcp', label: 'Modbus TCP' },
		{ value: 'rtu-over-tcp', label: 'Modbus RTU over TCP' }
	] as const;
</script>

<div class="flex flex-col gap-1.5">
	<Label for="connection-host">{m.devices_field_host()}</Label>
	<Input id="connection-host" bind:value={params.host} autocomplete="off" />
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-port">{m.devices_field_port()}</Label>
	<Input id="connection-port" type="number" min={1} max={65535} bind:value={params.port} />
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-transport">{m.inverter_transport()}</Label>
	<NativeSelect.Root id="connection-transport" class="w-full" bind:value={params.transport}>
		{#each TRANSPORTS as t (t.value)}
			<NativeSelect.Option value={t.value}>{t.label}</NativeSelect.Option>
		{/each}
	</NativeSelect.Root>
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-timeout">{m.inverter_timeout()}</Label>
	<Input id="connection-timeout" type="number" min={100} bind:value={params.timeoutMs} />
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-poll">{m.inverter_poll_interval()}</Label>
	<Input
		id="connection-poll"
		type="number"
		min={1000}
		step={1000}
		bind:value={params.pollIntervalMs}
	/>
</div>
