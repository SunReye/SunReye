<script lang="ts">
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { api } from "$lib/api";
	import { Button } from "$lib/components/ui/button";
	import FormActions from "./form-actions.svelte";
	import InverterConnectionFields from "./inverter-connection-fields.svelte";
	import InverterStatusBadge from "./inverter-status-badge.svelte";
	import { Label } from "$lib/components/ui/label";
	import { Switch } from "$lib/components/ui/switch";
	import Section from '$lib/components/layout/section.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import SnapshotDialog from "./snapshot-dialog.svelte";
	import type { InverterConfig, InverterStatus, TestResult } from "./inverter-types";
	import * as m from "$lib/paraglide/messages";

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

	let cfg = $state<InverterConfig | null>(null);
	let saving = $state(false);
	let testing = $state(false);
	let snapshotOpen = $state(false);
	let testResult = $state<TestResult | null>(null);

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
	const simulated = $derived(status?.simulate === true);

	onMount(async () => {
		const { data } = await api.api.settings.inverter.get();
		// host may be empty when the inverter isn't configured yet; keep it a
		// string so the bound Input stays controlled.
		if (data) cfg = { ...data, host: data.host ?? "" };
	});

	/** The draft plus, during onboarding, the profile to test-read against. */
	function testBody() {
		if (!cfg) return null;
		return profileId ? { ...cfg, profileId } : cfg;
	}

	async function runTest(body: InverterConfig & { profileId?: string }): Promise<TestResult> {
		const { data, error } = await api.api.settings.inverter.test.post(body);
		return data ?? { ok: false, error: error ? String(error.value) : m.conn_request_failed() };
	}

	async function test() {
		const body = testBody();
		if (!body) return;
		testing = true;
		testResult = null;
		const outcome = await runTest(body);
		testing = false;
		testResult = outcome;
		// On success, surface the captured snapshot for a plausibility check.
		if (outcome.ok && hasSnapshot) snapshotOpen = true;
	}

	/**
	 * Persist the connection. Exported (reachable via `bind:this`) so a caller
	 * that owns its own navigation — the setup wizard's Continue — can save
	 * before advancing instead of leaving a tested-but-unsaved config behind.
	 * Returns whether the write succeeded.
	 */
	/**
	 * Whether this draft is missing the one thing it cannot be saved without.
	 *
	 * A host is required only when something real is meant to be polled. While
	 * simulating there is nothing to dial, and demanding an address made the form
	 * unsaveable on exactly the box that needs it most: a fresh install with no
	 * inverter yet could not even turn the simulator off.
	 */
	const missingHost = $derived(cfg !== null && !cfg.simulate && !cfg.host.trim());

	export async function save(): Promise<boolean> {
		if (!cfg) return false;
		if (missingHost) {
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
	<EmptyState message={m.app_loading()} />
{:else}
	<Section title={m.inverter_connection()}>
		{#snippet actions()}
			<InverterStatusBadge {status} />
		{/snippet}

		<!--
			A control, not a notice. This used to say "set by the INVERTER_SIMULATE
			environment variable" — true for Docker, useless everywhere else, and on
			an appliance actively wrong: the owner cannot reach that variable, so the
			only path most people use dead-ended here. They would save their
			inverter's address, keep seeing invented readings, and have nothing to
			click.
		-->
		<div class="flex items-start justify-between gap-4 border border-border p-2.5">
			<div class="flex flex-col gap-1">
				<Label for="inverter-simulate">{m.inverter_simulate_label()}</Label>
				<p class="max-w-prose text-xs text-muted-foreground">
					{m.inverter_simulate_desc()}
				</p>
				{#if cfg.simulate}
					<p class="text-xs font-medium text-muted-foreground">
						{m.inverter_simulate_on_notice()}
					</p>
				{/if}
			</div>
			<Switch
				id="inverter-simulate"
				checked={cfg.simulate}
				onCheckedChange={(value) => {
					if (cfg) cfg.simulate = value;
				}}
			/>
		</div>

		<InverterConnectionFields bind:cfg {status} />
	</Section>

	<SnapshotDialog bind:open={snapshotOpen} result={testResult} />
{/if}
