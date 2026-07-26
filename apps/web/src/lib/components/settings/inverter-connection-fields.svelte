<script lang="ts">
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import * as Select from "$lib/components/ui/select";
	import type { InverterConfig, InverterStatus, Transport } from "./inverter-types";
	import * as m from "$lib/paraglide/messages";

	// The Modbus connection fields. The active profile is read-only here — it is
	// chosen on the profiles page and only takes effect after a restart — and is
	// only shown once the engine has reported its status.
	let {
		cfg = $bindable(),
		status
	}: {
		cfg: InverterConfig;
		status: InverterStatus | null;
	} = $props();

	const TRANSPORTS: { value: Transport; label: string }[] = [
		{ value: "tcp", label: "Modbus TCP" },
		{ value: "rtu-over-tcp", label: "Modbus RTU over TCP" }
	];
	const transportLabel = $derived(
		TRANSPORTS.find((x) => x.value === cfg.transport)?.label ?? "Modbus TCP"
	);
	const activeProfile = $derived(status?.profile ?? "—");

	function setTransport(v: string) {
		cfg.transport = v as Transport;
	}
</script>

<div class="grid gap-4 sm:grid-cols-2">
	<div class="flex flex-col gap-1.5">
		<Label for="host">Host</Label>
		<Input id="host" bind:value={cfg.host} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="port">Port</Label>
		<Input id="port" type="number" bind:value={cfg.port} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label>{m.inverter_transport()}</Label>
		<Select.Root type="single" value={cfg.transport} onValueChange={setTransport}>
			<Select.Trigger>{transportLabel}</Select.Trigger>
			<Select.Content>
				{#each TRANSPORTS as t (t.value)}
					<Select.Item value={t.value}>{t.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="unit">Unit ID</Label>
		<Input id="unit" type="number" bind:value={cfg.unitId} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="timeout">{m.inverter_timeout()}</Label>
		<Input id="timeout" type="number" bind:value={cfg.timeoutMs} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="poll">{m.inverter_poll_interval()}</Label>
		<Input id="poll" type="number" min={1000} step={1000} bind:value={cfg.pollIntervalMs} />
	</div>
	{#if status}
		<div class="flex flex-col gap-1.5">
			<Label>{m.inverter_active_profile()}</Label>
			<div class="flex h-9 items-center px-1 text-sm text-muted-foreground">
				{activeProfile}
				<span class="ml-2 text-xs">{m.inverter_change_requires_restart()}</span>
			</div>
		</div>
	{/if}
</div>
