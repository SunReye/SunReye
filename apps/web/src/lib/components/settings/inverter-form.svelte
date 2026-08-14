<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { api } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import * as Select from "$lib/components/ui/select";
	import FormActions from "./form-actions.svelte";
	import SettingsSection from "./settings-section.svelte";
	import SnapshotDialog from "./snapshot-dialog.svelte";
	import StatusBadge from "./status-badge.svelte";
	import * as m from "$lib/paraglide/messages";

	type Transport = "tcp" | "rtu-over-tcp";
	type InverterConfig = {
		host: string;
		port: number;
		transport: Transport;
		unitId: number;
		timeoutMs: number;
		pollIntervalMs: number;
	};

	const TRANSPORTS: { value: Transport; label: string }[] = [
		{ value: "tcp", label: "Modbus TCP" },
		{ value: "rtu-over-tcp", label: "Modbus RTU over TCP" }
	];
	const transportLabel = (t: Transport) =>
		TRANSPORTS.find((x) => x.value === t)?.label ?? "Modbus TCP";
	type InverterStatus = {
		connected: boolean;
		simulate: boolean;
		lastError: string | null;
		lastSampleAt: string | null;
		profile: string;
	};

	let {
		status = null,
		profileId = undefined
	}: {
		status?: InverterStatus | null;
		// When set (onboarding), test-reads run against this chosen profile instead
		// of the active one. Omitted on the settings page, where the server falls
		// back to the active profile.
		profileId?: string;
	} = $props();

	type SnapshotMetric = {
		key: string;
		label: string;
		unit: string | null;
		group: string;
		value: number;
		display?: string;
	};

	let cfg = $state<InverterConfig | null>(null);
	let saving = $state(false);
	let testing = $state(false);
	let snapshotOpen = $state(false);
	let testResult = $state<{
		ok: boolean;
		error?: string;
		metricCount?: number;
		durationMs?: number;
		metrics?: SnapshotMetric[];
	} | null>(null);

	const result = $derived(
		testResult
			? {
					ok: testResult.ok,
					message: testResult.ok
						? m.inverter_test_ok({
								count: testResult.metricCount ?? 0,
								ms: testResult.durationMs ?? 0,
							})
						: m.conn_test_failed({ error: testResult.error ?? "" }),
				}
			: null,
	);

	const hasSnapshot = $derived((testResult?.metrics?.length ?? 0) > 0);

	onMount(async () => {
		const { data } = await api.api.settings.inverter.get();
		// host may be empty when the inverter isn't configured yet; keep it a
		// string so the bound Input stays controlled.
		if (data) cfg = { ...data, host: data.host ?? "" };
	});

	async function test() {
		if (!cfg) return;
		testing = true;
		testResult = null;
		const { data, error } = await api.api.settings.inverter.test.post(
			profileId ? { ...cfg, profileId } : cfg
		);
		testing = false;
		testResult = data ?? {
			ok: false,
			error: error ? String(error.value) : m.conn_request_failed(),
		};
		// On success, surface the captured snapshot for a plausibility check.
		if (testResult.ok && (testResult.metrics?.length ?? 0) > 0) snapshotOpen = true;
	}

	/**
	 * Persist the connection. Exported (reachable via `bind:this`) so a caller
	 * that owns its own navigation — the setup wizard's Continue — can save
	 * before advancing instead of leaving a tested-but-unsaved config behind.
	 * Returns whether the write succeeded.
	 */
	export async function save(): Promise<boolean> {
		if (!cfg) return false;
		if (!cfg.host.trim()) {
			toast.error(m.inverter_toast_host_required());
			return false;
		}
		saving = true;
		const { error } = await api.api.settings.inverter.put(cfg);
		saving = false;
		if (error) {
			toast.error(m.inverter_toast_error());
			return false;
		}
		toast.success(m.inverter_toast_saved());
		return true;
	}
</script>

<FormActions {result} {testing} {saving} disabled={!cfg} ontest={test} onsave={save}>
	{#if hasSnapshot}
		<Button variant="ghost" size="sm" onclick={() => (snapshotOpen = true)}>
			{m.inverter_view_snapshot()}
		</Button>
	{/if}
</FormActions>

{#if !cfg}
	<div
		class="flex h-40 items-center justify-center border border-border text-sm text-muted-foreground"
	>
		{m.app_loading()}
	</div>
{:else}
	<SettingsSection title={m.inverter_connection()}>
		{#snippet actions()}
			{#if status}
				<StatusBadge
					ok={status.connected}
					label={status.simulate
						? m.inverter_status_simulated()
						: status.connected
							? m.status_connected()
							: m.inverter_status_disconnected()}
				/>
			{/if}
		{/snippet}

		{#if status?.simulate}
			<p
				class="border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground"
			>
				{m.inverter_simulate_pre()} <code>INVERTER_SIMULATE</code>
				{m.inverter_simulate_post()}
			</p>
		{/if}

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
				<Select.Root
					type="single"
					value={cfg.transport}
					onValueChange={(v) => {
						if (cfg) cfg.transport = v as Transport;
					}}
				>
					<Select.Trigger>{transportLabel(cfg.transport)}</Select.Trigger>
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
				<Input
					id="poll"
					type="number"
					min={1000}
					step={1000}
					bind:value={cfg.pollIntervalMs}
				/>
			</div>
			{#if status}
				<div class="flex flex-col gap-1.5">
					<Label>{m.inverter_active_profile()}</Label>
					<div
						class="flex h-9 items-center px-1 text-sm text-muted-foreground"
					>
						{status.profile ?? "—"}
						<span class="ml-2 text-xs">{m.inverter_change_requires_restart()}</span>
					</div>
				</div>
			{/if}
		</div>
	</SettingsSection>

	<SnapshotDialog bind:open={snapshotOpen} result={testResult} />
{/if}
