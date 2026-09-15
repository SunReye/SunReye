<script lang="ts">
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import * as Select from "$lib/components/ui/select";
	import type { InverterConfig, InverterStatus, Transport } from "./inverter-types";
	import { transportLabel, transportOptions } from "./transport-label";
	import UnitScan from "./devices/unit-scan.svelte";
	import { configScanTarget, unitIdHelp } from "./devices/unit-scan-logic";
	import * as m from "$lib/paraglide/messages";

	// The Modbus connection fields. The active profile is read-only here — it is
	// chosen on the profiles page and only takes effect after a restart — and is
	// only shown once the engine has reported its status.
	let {
		cfg = $bindable(),
		status,
		profileId = undefined,
		disabled = false
	}: {
		cfg: InverterConfig;
		status: InverterStatus | null;
		/**
		 * The profile a unit-id scan reads with: the one being set up during
		 * onboarding, else the active one. Without either there is no register map
		 * to ask with and the scan says so rather than guessing an address.
		 */
		profileId?: string;
		/**
		 * Greyed out because nothing here would be dialled. Set while the box is
		 * simulating: an address you can type and that is then ignored is how
		 * someone ends up believing they configured their inverter.
		 */
		disabled?: boolean;
	} = $props();

	// Framing names come from `./transport-label.ts`, which every surface that
	// shows one reads: three copies of the pair meant a German operator read
	// "Modbus RTU over TCP" on a page whose every other word was translated.
	const TRANSPORTS = transportOptions();
	const chosenLabel = $derived(transportLabel(cfg.transport));
	const activeProfile = $derived(status?.profile ?? "—");
	// What the unit id addresses depends on the framing above it: a bus framing
	// means the inverter's own slave address, a gateway means whatever the gateway
	// decides. Measured on one plant's two paths to one inverter — the gateway
	// answers 0 and times out on 1, the stick answers 1 and times out on 0.
	const unitHelp = $derived(unitIdHelp(cfg.transport));
	const scanTarget = $derived(
		disabled ? null : configScanTarget(cfg, profileId ?? status?.profile ?? null)
	);

	function setTransport(v: string) {
		cfg.transport = v as Transport;
	}
</script>

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
	<div class="flex flex-col gap-1.5">
		<Label for="host">Host</Label>
		<Input id="host" bind:value={cfg.host} {disabled} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="port">Port</Label>
		<Input id="port" type="number" bind:value={cfg.port} {disabled} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label>{m.inverter_transport()}</Label>
		<Select.Root type="single" value={cfg.transport} onValueChange={setTransport} {disabled}>
			<Select.Trigger>{chosenLabel}</Select.Trigger>
			<Select.Content>
				{#each TRANSPORTS as t (t.value)}
					<Select.Item value={t.value}>{t.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="unit">{m.devices_field_unit_id()}</Label>
		<Input id="unit" type="number" bind:value={cfg.unitId} {disabled} />
		<UnitScan
			target={scanTarget}
			onFound={(unitId) => (cfg.unitId = unitId)}
			nothing={m.devices_unit_scan_needs_profile()}
		/>
		<p class="text-xs text-muted-foreground">{unitHelp}</p>
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="timeout">{m.inverter_timeout()}</Label>
		<Input id="timeout" type="number" bind:value={cfg.timeoutMs} {disabled} />
	</div>
	<div class="flex flex-col gap-1.5">
		<Label for="poll">{m.inverter_poll_interval()}</Label>
		<Input id="poll" type="number" min={1000} step={1000} bind:value={cfg.pollIntervalMs} {disabled} />
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
