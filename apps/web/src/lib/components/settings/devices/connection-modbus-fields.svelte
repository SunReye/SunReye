<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as m from '$lib/paraglide/messages';
	import type { Transport } from '../inverter-types';
	import { transportOptions } from '../transport-label';
	import { type ConnectionDraft, withTransport } from './connection-draft';

	// A Modbus gateway's addressing: the five columns `connections.params`
	// replaced, with the same defaults they carried — plus the logger serial the
	// Solarman envelope addresses its frames by, which no other framing has.
	//
	// The WHOLE draft rather than its Modbus half, because picking the framing is
	// a draft-level rule: it moves the port too, and the rule that decides
	// whether it may lives in `./connection-draft.ts` where the suite can hold it.
	let { connection = $bindable() }: { connection: ConnectionDraft } = $props();

	const TRANSPORTS = transportOptions();
	const params = $derived(connection.modbus);
	const solarman = $derived(params.transport === 'solarman-v5');

	// Not a `bind:value`: a Solarman stick listens on 8899, and an operator who
	// picks it and is then refused on 502 has been asked to know a number their
	// own choice already implies. A hand-typed port is left exactly as it is.
	function pick(transport: string) {
		connection = withTransport(connection, transport as Transport);
	}
</script>

<div class="flex flex-col gap-1.5">
	<Label for="connection-host">{m.devices_field_host()}</Label>
	<Input id="connection-host" bind:value={connection.modbus.host} autocomplete="off" />
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-port">{m.devices_field_port()}</Label>
	<Input
		id="connection-port"
		type="number"
		min={1}
		max={65535}
		bind:value={connection.modbus.port}
	/>
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-transport">{m.inverter_transport()}</Label>
	<NativeSelect.Root
		id="connection-transport"
		class="w-full"
		value={params.transport}
		onchange={(e) => pick(e.currentTarget.value)}
	>
		{#each TRANSPORTS as t (t.value)}
			<NativeSelect.Option value={t.value}>{t.label}</NativeSelect.Option>
		{/each}
	</NativeSelect.Root>
</div>
{#if solarman}
	<div class="flex flex-col gap-1.5 sm:col-span-2">
		<Label for="connection-logger-serial">{m.devices_field_logger_serial()}</Label>
		<Input
			id="connection-logger-serial"
			type="number"
			min={1}
			placeholder={m.devices_logger_serial_placeholder()}
			bind:value={connection.modbus.loggerSerial}
		/>
		<p class="text-xs text-muted-foreground">{m.devices_logger_serial_help()}</p>
	</div>
{/if}
<div class="flex flex-col gap-1.5">
	<Label for="connection-timeout">{m.inverter_timeout()}</Label>
	<Input id="connection-timeout" type="number" min={100} bind:value={connection.modbus.timeoutMs} />
</div>
<div class="flex flex-col gap-1.5">
	<Label for="connection-poll">{m.inverter_poll_interval()}</Label>
	<Input
		id="connection-poll"
		type="number"
		min={1000}
		step={1000}
		bind:value={connection.modbus.pollIntervalMs}
	/>
</div>
